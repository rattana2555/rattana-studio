"""rattana-autoedit · step 2: apply the cut list.  v1.0

usage: python -I cut.py <input.mp4> <workdir>

Reads keep.json (from prep.py, possibly edited by Claude) and writes:
  cut.webm     the jump-cut picture, 1080x1920 VP9, 30 fps (Chromium can decode it for rendering)
  cut_vo.wav   the matching speech track (vocals.wav cut the same way, tiny fades on every join)
  map.json     [{src_s, src_e, dst_s}] so word times can be moved onto the new timeline
  words_cut.json  words.json re-timed onto the cut timeline (words inside removed ranges are dropped)
"""
import sys, json, subprocess

def main():
    src, work = sys.argv[1], sys.argv[2]
    keep = json.load(open(f"{work}/keep.json"))
    words = json.load(open(f"{work}/words.json", encoding="utf-8"))
    parts_v, parts_a, maps, t = [], [], [], 0.0
    for i, (s, e) in enumerate(keep):
        parts_v.append(f"[0:v]trim={s}:{e},setpts=PTS-STARTPTS[v{i}]")
        parts_a.append(f"[1:a]atrim={s}:{e},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={max(0, e - s - 0.03):.3f}:d=0.03[a{i}]")
        maps.append({"src_s": s, "src_e": e, "dst_s": round(t, 3)}); t += e - s
    n = len(keep)
    fc = ";".join(parts_v + parts_a)
    fc += ";" + "".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30[v]"
    fc += ";" + "".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[a]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-i", f"{work}/vocals.wav", "-filter_complex", fc,
                    "-map", "[v]", "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-g", "15", f"{work}/cut.webm",
                    "-map", "[a]", "-ar", "48000", f"{work}/cut_vo.wav"], check=True)
    json.dump(maps, open(f"{work}/map.json", "w"), indent=0)
    out = []
    for w in words:
        for m in maps:
            if m["src_s"] - 0.05 <= w["s"] <= m["src_e"]:
                d = m["dst_s"] - m["src_s"]
                out.append({"w": w["w"], "s": round(w["s"] + d, 2), "e": round(min(w["e"], m["src_e"]) + d, 2)}); break
    json.dump(out, open(f"{work}/words_cut.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"cut: {n} ranges -> {t:.2f}s, {len(out)} words kept")

if __name__ == "__main__":
    main()
