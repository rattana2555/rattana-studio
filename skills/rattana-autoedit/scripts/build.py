"""rattana-autoedit · step 3: render.  v1.0

usage: python -I build.py <workdir> <out.mp4> [--stills t1,t2,...]

Needs <workdir>/edit.json (written by Claude, see SKILL.md), cut.webm, cut_vo.wav, map.json.
Assembles <workdir>/render/ (template + edit.js + vo.js) and renders with video-tools/extras/render.mjs.
"""
import sys, os, json, shutil, base64, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.expanduser("~/.claude/video-tools/extras/render.mjs")

def main():
    work, out = sys.argv[1], sys.argv[2]
    stills = sys.argv[sys.argv.index("--stills") + 1] if "--stills" in sys.argv else None
    rd = os.path.join(work, "render"); os.makedirs(rd, exist_ok=True)
    shutil.copy(os.path.join(HERE, "..", "template", "autoedit.html"), os.path.join(rd, "index.html"))
    if not os.path.exists(os.path.join(rd, "cut.webm")) or os.path.getmtime(os.path.join(work, "cut.webm")) > os.path.getmtime(os.path.join(rd, "cut.webm")):
        shutil.copy(os.path.join(work, "cut.webm"), os.path.join(rd, "cut.webm"))
    edit = json.load(open(os.path.join(work, "edit.json"), encoding="utf-8"))
    maps = json.load(open(os.path.join(work, "map.json")))
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", os.path.join(work, "cut_vo.wav")]).decode())
    edit.setdefault("duration", round(dur, 2)); edit.setdefault("cuts", [m["dst_s"] for m in maps])
    open(os.path.join(rd, "edit.js"), "w", encoding="utf-8").write("window.EDIT=" + json.dumps(edit, ensure_ascii=False) + ";\n")
    mono = os.path.join(work, "cut_vo_mono.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(work, "cut_vo.wav"), "-ac", "1", "-ar", "48000", mono], check=True)
    open(os.path.join(rd, "vo.js"), "w").write("window.VO=" + json.dumps(base64.b64encode(open(mono, "rb").read()).decode()) + ";\n")
    cmd = ["node", RENDER, os.path.join(rd, "index.html"), os.path.abspath(out)]
    cmd += ["--stills", stills] if stills else ["30", "2", "3"]
    subprocess.run(cmd, check=True)

if __name__ == "__main__":
    main()
