---
name: rattana-autoedit
description: Auto-edit a talking-head clip (Thai) into a CapCut-style vertical short — Whisper subtitles with word-by-word highlight, jump-cut silences and fillers, punch-in zooms on key words, pop titles, synced sound effects and a music bed — rendered to MP4 on this PC for free. Use when the user drops a video and asks to cut/edit it, add subtitles/ซับ, effects, sound, "ตัดคลิปให้", "ใส่ซับ", "แบบแคปคัต".
---

# rattana-autoedit v1.0

Talking-head clip in → edited 1080x1920 MP4 out. Everything runs locally (no credits).

## Tools (already installed on this PC)
- `PY = %USERPROFILE%\.claude\video-tools\venv-f5\Scripts\python.exe` (Python 3.11: faster-whisper, F5-TTS)
- Demucs (speech/music split) in `%USERPROFILE%\.claude\video-tools\venv-demucs`
- `%USERPROFILE%\.claude\video-tools\extras\render.mjs` (Playwright renderer, used by build.py)
- Scripts in this skill: `scripts/prep.py`, `scripts/cut.py`, `scripts/build.py`; render page `template/autoedit.html`
- Always run Python with `-I`. Work in a fresh folder per job, e.g. `D:\Rattana studio\autoedit-<name>\work`.

## Workflow
1. **Prep** (≈1 min per 10 s of video on this CPU): `PY -I scripts/prep.py <video> <work>`
   → `words.json`, `segments.json`, `keep.json` (silences > 0.45 s and fillers removed). Add `--no-demucs` if the clip has no background music.
2. **Read the transcript yourself.** Whisper misspells Thai names and brand words. Fix them in your captions (glossary: รัตนไพบูลย์, รัตนมาร์ท / RATTANA MART, ธงฟ้าประชารัฐ, นครปฐม …). Edit `keep.json` to drop repeated sentences, false starts or off-topic bits — this is the "editor's judgement" step.
3. **Cut**: `PY -I scripts/cut.py <video> <work>` → `cut.webm`, `cut_vo.wav`, `words_cut.json`, `map.json`.
4. **Write `<work>/edit.json`** from `words_cut.json` (times are on the cut timeline):
   ```json
   {
     "capStyle": "pop",                       // pop (white+black stroke, active word yellow) | box (yellow box on active word) | gold (navy panel, brand)
     "captions": [ {"s":0.0,"e":1.6,"lines":[[{"t":"ชาวนครปฐม","s":0.0,"e":0.7,"c":"#FFE14D"},{"t":"เตรียมตัว!","s":0.7,"e":1.5}]]} ],
     "titles":  [ {"s":0.1,"e":2.0,"text":"ชาวนครปฐมเตรียมตัว!","style":"pop","y":260} ],   // pop | banner | yellow
     "zooms":   [ {"s":3.2,"e":4.4,"scale":1.2} ],   // punch-in on a key word
     "flash":   [ 9.8 ],                              // white flash at a topic change
     "sfx":     [ {"t":0.1,"type":"whoosh"},{"t":3.2,"type":"pop"} ],   // whoosh pop ding boom click cash
     "music":   {"bpm":104,"level":0.1}
   }
   ```
   Rules: captions ≤ 2 lines, ≤ ~16 Thai characters per line, 1–4 words per line, never covering the face (default top 1250 px). Colour 1–2 key words per caption (numbers, dates, brand). One title per topic, ≤ 2 s. Zoom on ~1 key word every 5–8 s. Every title gets a whoosh, every zoom a pop, dates/prices a ding or cash. Don't over-decorate: ~1 effect per 1.5 s.
5. **Check stills**: `PY -I scripts/build.py <work> <work>/check.png --stills 0.5,3,8,...` — open and look at every frame (face covered? text overflow? Thai spelling?).
6. **Render**: `PY -I scripts/build.py <work> <out.mp4>` (≈3 min per 30 s). Output is loudness-normalised (−16 LUFS). Verify with ffprobe + a contact sheet before handing over.
7. Give the user the MP4 and say plainly what you could not check (you cannot listen: ask them to check lip-sync of captions).

## Notes
- Jump cuts alternate a 1.0 / 1.08 punch-in automatically (CapCut style) so cuts don't look like glitches.
- The synth music bed is generated in code (royalty-free). To use a licensed track instead, mix it afterwards with ffmpeg (`sidechaincompress` to duck under speech).
- Burned-in text already in the source can clash with new captions — crop or move captions (`#cap` top) if needed.
