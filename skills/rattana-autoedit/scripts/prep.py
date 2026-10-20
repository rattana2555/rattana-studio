"""rattana-autoedit · step 1: analyse a talking-head clip.  v1.0

usage: <venv-f5>/python -I prep.py <input.mp4> <workdir> [--no-demucs]

Writes into <workdir>:
  audio.wav        original audio (48k stereo)
  vocals.wav       speech only (Demucs htdemucs, unless --no-demucs)
  words.json       Whisper large-v3 word timestamps on the speech  [{w,s,e}]
  segments.json    Whisper sentence segments                       [{t,s,e}]
  keep.json        speech ranges to keep (silence > MIN_GAP cut out) [[s,e],...]
  probe.json       width/height/fps/duration of the input
"""
import sys, os, json, subprocess, re

DEMUCS_PY = os.path.expanduser("~/.claude/video-tools/venv-demucs/Scripts/python.exe")
MIN_GAP, PAD = 0.45, 0.12        # cut silences longer than MIN_GAP, keep PAD seconds around speech
FILLERS = {"เอ่อ", "อ่า", "อืม", "เอิ่ม", "แบบว่า", "อ่ะ"}

def sh(*a, **k): return subprocess.run(a, check=True, capture_output=True, text=True, **k)

def main():
    src, work = sys.argv[1], sys.argv[2]
    use_demucs = "--no-demucs" not in sys.argv
    os.makedirs(work, exist_ok=True)
    p = json.loads(sh("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", src).stdout)
    st = p["streams"][0]; num, den = map(int, st["r_frame_rate"].split("/"))
    probe = {"w": st["width"], "h": st["height"], "fps": round(num / den, 3), "dur": float(p["format"]["duration"])}
    json.dump(probe, open(f"{work}/probe.json", "w"))
    sh("ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "2", "-ar", "48000", f"{work}/audio.wav")

    voc = f"{work}/audio.wav"
    if use_demucs and os.path.exists(DEMUCS_PY):
        sh(DEMUCS_PY, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", f"{work}/sep", f"{work}/audio.wav")
        sh("ffmpeg", "-v", "error", "-y", "-i", f"{work}/sep/htdemucs/audio/vocals.wav", "-ar", "48000", f"{work}/vocals.wav")
        voc = f"{work}/vocals.wav"
    else:
        sh("ffmpeg", "-v", "error", "-y", "-i", voc, f"{work}/vocals.wav")

    from faster_whisper import WhisperModel
    TH = os.path.expanduser("~/.claude/video-tools/models/whisper-th-large-v3-ct2")
    m = WhisperModel(TH if os.path.exists(os.path.join(TH, "model.bin")) else "large-v3", device="cpu", compute_type="int8", cpu_threads=max(4, (os.cpu_count() or 8) - 4))
    segs, _ = m.transcribe(voc, language="th", word_timestamps=True, beam_size=1, vad_filter=True, condition_on_previous_text=False)
    words, sents = [], []
    for s in segs:
        sents.append({"t": s.text.strip(), "s": round(s.start, 2), "e": round(s.end, 2)})
        for w in s.words:
            words.append({"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)})
    json.dump(words, open(f"{work}/words.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    json.dump(sents, open(f"{work}/segments.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # speech ranges from words (fillers dropped), merged when the gap is short
    spans = [[w["s"], w["e"]] for w in words if re.sub(r"\s", "", w["w"]) not in FILLERS]
    keep = []
    for s, e in spans:
        s, e = max(0, s - PAD), min(probe["dur"], e + PAD)
        if keep and s - keep[-1][1] < MIN_GAP: keep[-1][1] = max(keep[-1][1], e)
        else: keep.append([round(s, 3), round(e, 3)])
    json.dump(keep, open(f"{work}/keep.json", "w"))
    total = sum(e - s for s, e in keep)
    print(f"words={len(words)} sentences={len(sents)} keep={len(keep)} ranges, {total:.1f}s of {probe['dur']:.1f}s")

if __name__ == "__main__":
    main()
