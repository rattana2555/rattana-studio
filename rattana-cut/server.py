"""Rattana Cut v1.0 — local video editor server.

Run:  start-rattana-cut.bat   (or)   <venv-f5>\\Scripts\\python.exe -I server.py
Opens http://localhost:8765

Stdlib HTTP server + background jobs (ffmpeg proxies, Whisper captions, Playwright export).
Projects live in ./projects/<id>/ (project.json + media/ + exports/).
"""
import json, os, re, shutil, subprocess, sys, threading, time, uuid, wave, struct, mimetypes, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
PROJ = os.path.join(ROOT, "projects")
SFX_DIR = os.path.expanduser("~/.claude/skills/sound-effects/sfx")
PORT = int(os.environ.get("RATTANA_CUT_PORT") or os.environ.get("PORT") or "8765")
VERSION = "1.1"
os.makedirs(PROJ, exist_ok=True)
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
mimetypes.add_type("video/webm", ".webm"); mimetypes.add_type("audio/ogg", ".ogg"); mimetypes.add_type("text/javascript", ".mjs")

# ───────────────────────── jobs ─────────────────────────
JOBS, JLOCK = {}, threading.Lock()
WHISPER_LOCK = threading.Lock()   # one transcription at a time (CPU bound)
_whisper = None

def job_new(kind, fn, *args):
    jid = uuid.uuid4().hex[:10]
    JOBS[jid] = {"id": jid, "kind": kind, "state": "running", "progress": 0, "msg": "", "result": None}
    def run():
        try:
            JOBS[jid]["result"] = fn(JOBS[jid], *args); JOBS[jid]["state"] = "done"; JOBS[jid]["progress"] = 100
        except Exception as e:  # report to UI
            JOBS[jid]["state"] = "error"; JOBS[jid]["msg"] = str(e)[-600:]
    threading.Thread(target=run, daemon=True).start()
    return jid

def run(cmd, **k):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **k)
    if r.returncode: raise RuntimeError(f"{os.path.basename(cmd[0])} failed: {r.stderr[-400:]}")
    return r.stdout

def probe(path):
    j = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", path]))
    v = next((s for s in j.get("streams", []) if s["codec_type"] == "video"), None)
    a = next((s for s in j.get("streams", []) if s["codec_type"] == "audio"), None)
    return {"dur": float(j["format"].get("duration", 0) or 0), "w": v and v.get("width"), "h": v and v.get("height"), "hasAudio": a is not None, "hasVideo": v is not None}

def pdir(pid):
    d = os.path.join(PROJ, re.sub(r"[^a-zA-Z0-9_-]", "", pid))
    if not os.path.isdir(d): raise FileNotFoundError("project not found")
    return d

def load_proj(pid): return json.load(open(os.path.join(pdir(pid), "project.json"), encoding="utf-8"))
def save_proj(pid, p):
    p["updated"] = time.time()
    tmp = os.path.join(pdir(pid), "project.json.tmp")
    json.dump(p, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, os.path.join(pdir(pid), "project.json"))

PLOCK = threading.Lock()
def patch_media(pid, mid, **kv):
    with PLOCK:
        p = load_proj(pid)
        for m in p["media"]:
            if m["id"] == mid: m.update(kv)
        save_proj(pid, p)

def peaks(wav_path, per_sec=50):
    with wave.open(wav_path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        data = w.readframes(n)
    vals = struct.unpack("<%dh" % (len(data) // 2), data)[::ch]
    step = max(1, sr // per_sec)
    return [round(max(abs(x) for x in vals[i:i + step]) / 32768, 3) for i in range(0, len(vals), step)]

def job_import(job, pid, mid, src):
    d = os.path.join(pdir(pid), "media"); base = os.path.join(d, mid)
    info = probe(src); job["msg"] = "กำลังเตรียมไฟล์"
    out = {"dur": round(info["dur"], 3), "w": info["w"], "h": info["h"], "hasAudio": info["hasAudio"]}
    if info["hasAudio"]:
        run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "48000", base + ".wav"]); out["wav"] = mid + ".wav"
        out["peaks"] = peaks(base + ".wav"); job["progress"] = 15
    if info["hasVideo"] and info["dur"] > 0.2:
        w, h = info["w"] or 1080, info["h"] or 1920
        sc = "scale=-2:1080" if w >= h else "scale=1080:-2"
        if min(w, h) < 1080: sc = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
        run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"{sc},fps=30", "-frames:v", "1", "-ss", "0", base + ".jpg"])
        cols = max(1, min(40, int(info["dur"] // 2) or 1))
        run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"fps={cols}/{max(info['dur'],.5)},scale=-2:120,tile={cols}x1", "-frames:v", "1", base + "_strip.jpg"])
        out.update(thumb=mid + ".jpg", strip=mid + "_strip.jpg", stripN=cols); job["progress"] = 25
        job["msg"] = "กำลังแปลงไฟล์สำหรับตัดต่อ"
        proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-progress", "pipe:1", "-i", src, "-vf", f"{sc},fps=30",
                                 "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "6", "-g", "15",
                                 "-c:a", "libopus", "-b:a", "128k", base + ".webm"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for line in proc.stdout:
            if line.startswith("out_time_ms="):
                try: job["progress"] = 25 + min(74, int(line.split("=")[1]) / 1e6 / max(info["dur"], .1) * 74)
                except ValueError: pass
        if proc.wait(): raise RuntimeError("แปลงวิดีโอไม่สำเร็จ: " + proc.stderr.read()[-300:])
        out["proxy"] = mid + ".webm"; out["type"] = "video"
    elif info["hasVideo"]:
        ext = os.path.splitext(src)[1].lower(); shutil.copy(src, base + ext); out.update(type="image", img=mid + ext, thumb=mid + ext, dur=5)
    else:
        out["type"] = "audio"
    out["ready"] = True
    patch_media(pid, mid, **out)
    return out

TH_MODEL = os.path.expanduser("~/.claude/video-tools/models/whisper-th-large-v3-ct2")
SETTINGS_F = os.path.join(ROOT, "settings.json")
def settings(): return json.load(open(SETTINGS_F, encoding="utf-8")) if os.path.exists(SETTINGS_F) else {}

def job_transcribe(job, pid, mid, use_demucs, glossary=""):
    global _whisper
    d = os.path.join(pdir(pid), "media"); wav = os.path.join(d, mid + ".wav")
    if not os.path.exists(wav): raise RuntimeError("คลิปนี้ไม่มีเสียง")
    src = wav
    demucs = os.path.expanduser("~/.claude/video-tools/venv-demucs/Scripts/python.exe")
    if use_demucs and os.path.exists(demucs):
        job["msg"] = "กำลังแยกเสียงพูดออกจากเพลง"; job["progress"] = 5
        run([demucs, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", os.path.join(d, "sep"), wav])
        src = os.path.join(d, "sep", "htdemucs", mid, "vocals.wav")
    job["msg"] = "รอคิวถอดเสียง"
    with WHISPER_LOCK:
        job["msg"] = "กำลังโหลดโมเดล AI"; job["progress"] = 20
        if _whisper is None:
            from faster_whisper import WhisperModel
            # Thai fine-tuned model (Thonburian Whisper, converted to CTranslate2) when available
            _whisper = WhisperModel(TH_MODEL if os.path.exists(os.path.join(TH_MODEL, "model.bin")) else "large-v3", device="cpu", compute_type="int8", cpu_threads=max(4, (os.cpu_count() or 8) - 4))
        dur = probe(src)["dur"] or 1
        job["msg"] = "AI กำลังฟังและถอดเสียง"
        # greedy decoding on all cores ≈ 4x faster on this CPU with the Thai model and no loss we could measure;
        # the glossary is NOT sent as a prompt (it leaked into the output) — the app uses it for word splitting instead
        segs, _ = _whisper.transcribe(src, language="th", task="transcribe", word_timestamps=True, beam_size=1, vad_filter=True, condition_on_previous_text=False)
        words = []
        for s in segs:
            for w in s.words:
                words.append({"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)})
            job["progress"] = 20 + min(79, s.end / dur * 79)
    patch_media(pid, mid, words=words)
    return {"words": len(words)}

def job_download(job, pid, url):
    """Download a video/audio the user has rights to (yt-dlp), then import it."""
    tmp = os.path.join(pdir(pid), "media", "dl_" + uuid.uuid4().hex[:6])
    job["msg"] = "กำลังดาวน์โหลด"
    proc = subprocess.Popen([sys.executable, "-m", "yt_dlp", "--no-playlist", "-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4",
                             "-o", tmp + ".%(ext)s", "--newline", url], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    tail = ""
    for line in proc.stdout:
        tail = (tail + line)[-600:]
        m = re.search(r"(\d+(?:\.\d+)?)%", line)
        if m: job["progress"] = min(60, float(m.group(1)) * .6)
    if proc.wait(): raise RuntimeError("ดาวน์โหลดไม่สำเร็จ: " + tail[-300:])
    f = next((os.path.join(os.path.dirname(tmp), x) for x in os.listdir(os.path.dirname(tmp)) if x.startswith(os.path.basename(tmp))), None)
    if not f: raise RuntimeError("ไม่พบไฟล์ที่ดาวน์โหลด")
    mid = "m" + uuid.uuid4().hex[:8]; orig = os.path.join(pdir(pid), "media", mid + "_orig" + os.path.splitext(f)[1])
    os.replace(f, orig)
    with PLOCK:
        p = load_proj(pid); p["media"].append({"id": mid, "name": url[:60], "orig": os.path.basename(orig), "ready": False}); save_proj(pid, p)
    sub = {"progress": 0, "msg": ""}
    t = threading.Thread(target=lambda: job_import(sub, pid, mid, orig)); t.start()
    while t.is_alive(): job["progress"] = 60 + sub["progress"] * .4; job["msg"] = sub["msg"]; time.sleep(.5)
    return {"mediaId": mid}

def job_pack(job, pid):
    """Save the whole project (json + original media) as one .rcut file."""
    import zipfile
    d = pdir(pid); p = load_proj(pid); ex = os.path.join(d, "exports"); os.makedirs(ex, exist_ok=True)
    name = re.sub(r'[\\/:*?"<>|\s]+', "-", p.get("name") or "project") + ".rcut"; out = os.path.join(ex, name)
    files = [m["orig"] for m in p["media"] if m.get("orig")]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        z.writestr("project.json", json.dumps(p, ensure_ascii=False))
        for i, f in enumerate(files):
            fp = os.path.join(d, "media", f)
            if os.path.exists(fp): z.write(fp, "media/" + f)
            job["progress"] = (i + 1) / max(1, len(files)) * 100
    return {"file": f"/projects/{pid}/exports/{name}", "name": name}

def job_unpack(job, src):
    import zipfile
    pid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]; d = os.path.join(PROJ, pid); os.makedirs(os.path.join(d, "media"))
    with zipfile.ZipFile(src) as z:
        p = json.loads(z.read("project.json").decode("utf-8"))
        for n in z.namelist():
            if n.startswith("media/") and not n.endswith("/"): open(os.path.join(d, "media", os.path.basename(n)), "wb").write(z.read(n))
    os.remove(src)
    p["id"] = pid; p["name"] = (p.get("name") or "โปรเจกต์") + " (เปิดจากไฟล์)"
    for m in p["media"]: m.update(ready=False)
    save_proj(pid, p)
    for i, m in enumerate(p["media"]):
        job["msg"] = f"เตรียมสื่อ {i+1}/{len(p['media'])}"; job_import({"progress": 0, "msg": ""}, pid, m["id"], os.path.join(d, "media", m["orig"]))
        job["progress"] = (i + 1) / max(1, len(p["media"])) * 100
    return {"id": pid}

def job_export(job, pid, opts):
    d = pdir(pid); ex = os.path.join(d, "exports"); os.makedirs(ex, exist_ok=True)
    p = load_proj(pid)
    name = re.sub(r'[\\/:*?"<>|\s]+', "-", p.get("name") or "rattana-cut") + time.strftime("-%Y%m%d-%H%M%S") + ".mp4"
    out = os.path.join(ex, name)
    url = f"http://127.0.0.1:{PORT}/render.html?p={pid}&short={int(opts.get('short', 1080))}"
    proc = subprocess.Popen(["node", os.path.join(ROOT, "render_url.mjs"), url, out, str(int(opts.get("fps", 30)))],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", cwd=ROOT)
    tail = ""
    for line in proc.stdout:
        tail = (tail + line)[-800:]
        m = re.search(r"PROGRESS (\d+)/(\d+)", line)
        if m: job["progress"] = int(m.group(1)) / max(1, int(m.group(2))) * 95; job["msg"] = "กำลังสร้างวิดีโอ"
        if "AUDIO" in line: job["msg"] = "กำลังผสมเสียง"; job["progress"] = 96
    if proc.wait(): raise RuntimeError("ส่งออกไม่สำเร็จ: " + tail)
    return {"file": f"/projects/{pid}/exports/{name}", "name": name}

# ───────────────────────── stock libraries (official APIs only) ─────────────────────────
import urllib.request
from urllib.parse import urlencode
_cache = {}
def _get_json(url, ttl=24 * 3600):
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < ttl: return hit[1]          # Pixabay asks for 24 h caching
    req = urllib.request.Request(url, headers={"User-Agent": "RattanaCut/1.1"})
    with urllib.request.urlopen(req, timeout=20) as r: data = json.loads(r.read().decode("utf-8"))
    _cache[url] = (time.time(), data); return data

def pixabay(q):
    key = settings().get("pixabayKey")
    if not key: return {"error": "ยังไม่ได้ใส่ Pixabay API key (กดปุ่ม ⚙ ตั้งค่า)"}
    kind = (q.get("type") or ["video"])[0]
    params = {"key": key, "q": (q.get("q") or [""])[0][:100], "per_page": 30, "safesearch": "true", "page": (q.get("page") or ["1"])[0]}
    url = ("https://pixabay.com/api/videos/?" if kind == "video" else "https://pixabay.com/api/?") + urlencode(params)
    try: d = _get_json(url)
    except Exception as e: return {"error": f"Pixabay: {e}"}
    out = []
    for h in d.get("hits", []):
        if kind == "video":
            v = h["videos"].get("medium") or h["videos"].get("small") or {}
            out.append({"id": h["id"], "thumb": v.get("thumbnail"), "url": v.get("url"), "dur": h.get("duration"), "user": h.get("user"), "page": h.get("pageURL")})
        else:
            out.append({"id": h["id"], "thumb": h.get("previewURL"), "url": h.get("largeImageURL") or h.get("webformatURL"), "user": h.get("user"), "page": h.get("pageURL")})
    return {"hits": out, "total": d.get("totalHits", 0)}

def freesound(q):
    key = settings().get("freesoundKey")
    if not key: return {"error": "ยังไม่ได้ใส่ Freesound API key (กดปุ่ม ⚙ ตั้งค่า)"}
    params = {"query": (q.get("q") or [""])[0][:100], "filter": 'license:"Creative Commons 0" duration:[0 TO 60]', "fields": "id,name,duration,previews,username,url", "page_size": 30, "token": key}
    try: d = _get_json("https://freesound.org/apiv2/search/text/?" + urlencode(params))
    except Exception as e: return {"error": f"Freesound: {e}"}
    return {"hits": [{"id": h["id"], "name": h["name"], "dur": round(h["duration"], 1), "url": h["previews"]["preview-hq-mp3"], "user": h["username"], "page": h["url"]} for h in d.get("results", [])]}

def start_import_file(pid, name, url=None, path=None):
    mid = "m" + uuid.uuid4().hex[:8]; ext = os.path.splitext(name)[1].lower()
    if ext not in (".mp3", ".wav", ".m4a", ".ogg", ".mp4", ".mov", ".webm", ".jpg", ".jpeg", ".png"): ext = ".mp3" if url and "freesound" in url else ".mp4"
    orig = os.path.join(pdir(pid), "media", mid + "_orig" + ext)
    item = {"id": mid, "name": name[:80], "orig": os.path.basename(orig), "ready": False}
    with PLOCK:
        p = load_proj(pid); p["media"].append(item); save_proj(pid, p)
    def fetch_then_import(job):
        if url:
            job["msg"] = "กำลังดาวน์โหลด"
            req = urllib.request.Request(url, headers={"User-Agent": "RattanaCut/1.1"})
            with urllib.request.urlopen(req, timeout=120) as r, open(orig, "wb") as f: shutil.copyfileobj(r, f)
        else: shutil.copy(path, orig)
        return job_import(job, pid, mid, orig)
    return {"media": item, "job": job_new("import", fetch_then_import)}

# ───────────────────────── http ─────────────────────────
def sfx_list():
    out = []
    if os.path.isdir(SFX_DIR):
        for cat in sorted(os.listdir(SFX_DIR)):
            cd = os.path.join(SFX_DIR, cat)
            if os.path.isdir(cd):
                for f in sorted(os.listdir(cd)):
                    if f.endswith((".ogg", ".wav", ".mp3")): out.append({"cat": cat, "file": f"{cat}/{f}", "name": os.path.splitext(f)[0][:40]})
    return out

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length", 0)); return self.rfile.read(n) if n else b""
    def _file(self, path):
        if not os.path.isfile(path): return self._json({"error": "not found"}, 404)
        size = os.path.getsize(path); ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1): start = int(m.group(1))
                if m.group(2): end = min(size - 1, int(m.group(2)))
                elif not m.group(1): start = size - int(m.group(2) or 0)
            self.send_response(206); self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else: self.send_response(200)
        self.send_header("Content-Type", ctype); self.send_header("Accept-Ranges", "bytes"); self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-cache"); self.end_headers()
        with open(path, "rb") as f:
            f.seek(start); left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk: break
                try: self.wfile.write(chunk)
                except (ConnectionResetError, BrokenPipeError): return
                left -= len(chunk)

    def do_GET(self):
        u = urlparse(self.path); path = unquote(u.path)
        try:
            if path == "/" : return self._file(os.path.join(STATIC, "index.html"))
            if path == "/api/info": return self._json({"version": VERSION})
            if path == "/api/projects":
                items = []
                for pid in os.listdir(PROJ):
                    if pid.startswith("_"): continue
                    f = os.path.join(PROJ, pid, "project.json")
                    if os.path.exists(f):
                        p = json.load(open(f, encoding="utf-8")); items.append({"id": pid, "name": p.get("name"), "updated": p.get("updated", 0), "ratio": p.get("ratio"), "thumb": next((f"/projects/{pid}/media/{m['thumb']}" for m in p["media"] if m.get("thumb")), None)})
                return self._json(sorted(items, key=lambda x: -x["updated"]))
            m = re.match(r"^/api/projects/([\w-]+)$", path)
            if m: return self._json(load_proj(m.group(1)))
            m = re.match(r"^/api/jobs/(\w+)$", path)
            if m: return self._json(JOBS.get(m.group(1), {"state": "missing"}))
            if path == "/api/sfx": return self._json(sfx_list())
            if path == "/api/settings":
                s2 = settings(); return self._json({**{k: ("•••" + v[-4:] if v and k.endswith("Key") else v) for k, v in s2.items()}, "thModel": os.path.exists(os.path.join(TH_MODEL, "model.bin"))})
            if path == "/api/pixabay": return self._json(pixabay(parse_qs(urlparse(self.path).query)))
            if path == "/api/freesound": return self._json(freesound(parse_qs(urlparse(self.path).query)))
            if path == "/api/recent-downloads":
                d = os.path.expanduser("~/Downloads"); now = time.time(); out = []
                for f in os.listdir(d):
                    fp = os.path.join(d, f)
                    if os.path.isfile(fp) and f.lower().endswith((".mp3", ".wav", ".m4a", ".ogg", ".mp4", ".mov", ".webm", ".jpg", ".png")) and now - os.path.getmtime(fp) < 6 * 3600:
                        out.append({"name": f, "mtime": os.path.getmtime(fp), "size": os.path.getsize(fp)})
                return self._json(sorted(out, key=lambda x: -x["mtime"])[:30])
            if path == "/api/news":
                f = os.path.join(ROOT, "announcements.json")
                return self._json(json.load(open(f, encoding="utf-8")) if os.path.exists(f) else [])
            if path.startswith("/sfx/"): return self._file(os.path.join(SFX_DIR, os.path.normpath(path[5:]).lstrip("\\/.")))
            if path.startswith("/projects/"):
                full = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
                if not full.startswith(PROJ): return self._json({"error": "bad path"}, 400)
                return self._file(full)
            full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
            if not full.startswith(STATIC): return self._json({"error": "bad path"}, 400)
            return self._file(full)
        except FileNotFoundError as e: return self._json({"error": str(e)}, 404)
        except Exception as e: return self._json({"error": str(e)}, 500)

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/projects":
                body = json.loads(self._body() or b"{}")
                pid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
                os.makedirs(os.path.join(PROJ, pid, "media"))
                p = {"id": pid, "name": body.get("name") or "โปรเจกต์ใหม่", "ratio": body.get("ratio") or "9:16", "media": [], "main": [], "items": [], "audio": [],
                     "settings": {"duck": True, "musicVol": .35}, "created": time.time()}
                save_proj(pid, p); return self._json(p)
            m = re.match(r"^/api/projects/([\w-]+)/import$", path)
            if m:
                pid = m.group(1); fname = unquote(self.headers.get("X-Filename", "file.mp4"))
                mid = "m" + uuid.uuid4().hex[:8]; ext = os.path.splitext(fname)[1].lower() or ".mp4"
                orig = os.path.join(pdir(pid), "media", mid + "_orig" + ext)
                n = int(self.headers.get("Content-Length", 0))
                with open(orig, "wb") as f:
                    while n > 0:
                        chunk = self.rfile.read(min(1 << 20, n));
                        if not chunk: break
                        f.write(chunk); n -= len(chunk)
                item = {"id": mid, "name": fname, "orig": os.path.basename(orig), "ready": False}
                with PLOCK:
                    p = load_proj(pid); p["media"].append(item); save_proj(pid, p)
                jid = job_new("import", job_import, pid, mid, orig)
                return self._json({"media": item, "job": jid})
            m = re.match(r"^/api/projects/([\w-]+)/transcribe$", path)
            if m:
                b = json.loads(self._body() or b"{}")
                return self._json({"job": job_new("transcribe", job_transcribe, m.group(1), b["mediaId"], bool(b.get("demucs")), b.get("glossary", ""))})
            m = re.match(r"^/api/projects/([\w-]+)/export$", path)
            if m:
                b = json.loads(self._body() or b"{}")
                return self._json({"job": job_new("export", job_export, m.group(1), b)})
            if path == "/api/settings":
                b = json.loads(self._body() or b"{}"); cur = settings()
                for k, v in b.items():
                    if isinstance(v, str) and v.startswith("•••"): continue
                    cur[k] = v
                json.dump(cur, open(SETTINGS_F, "w", encoding="utf-8"), ensure_ascii=False); return self._json({"ok": True})
            m = re.match(r"^/api/projects/([\w-]+)/import-url$", path)
            if m:
                b = json.loads(self._body()); url = b["url"]
                if not re.match(r"^https://([\w-]+\.)*(pixabay\.com|freesound\.org)/", url): return self._json({"error": "อนุญาตเฉพาะไฟล์จาก Pixabay / Freesound"}, 400)
                return self._json(start_import_file(m.group(1), b.get("name") or os.path.basename(urlparse(url).path), url=url))
            m = re.match(r"^/api/projects/([\w-]+)/import-download$", path)
            if m:
                name = os.path.basename(json.loads(self._body())["name"]); fp = os.path.join(os.path.expanduser("~/Downloads"), name)
                if not os.path.isfile(fp): return self._json({"error": "ไม่พบไฟล์"}, 404)
                return self._json(start_import_file(m.group(1), name, path=fp))
            m = re.match(r"^/api/projects/([\w-]+)/download$", path)
            if m: return self._json({"job": job_new("download", job_download, m.group(1), json.loads(self._body())["url"])})
            m = re.match(r"^/api/projects/([\w-]+)/pack$", path)
            if m: return self._json({"job": job_new("pack", job_pack, m.group(1))})
            if path == "/api/open-rcut":
                tmp = os.path.join(PROJ, "_upload_" + uuid.uuid4().hex[:6] + ".rcut"); n = int(self.headers.get("Content-Length", 0))
                with open(tmp, "wb") as f:
                    while n > 0:
                        c = self.rfile.read(min(1 << 20, n))
                        if not c: break
                        f.write(c); n -= len(c)
                return self._json({"job": job_new("unpack", job_unpack, tmp)})
            m = re.match(r"^/api/projects/([\w-]+)/reveal$", path)
            if m:
                f = json.loads(self._body() or b"{}").get("file", "")
                full = os.path.normpath(os.path.join(ROOT, f.lstrip("/")))
                if full.startswith(PROJ) and os.path.exists(full): subprocess.Popen(["explorer", "/select,", full])
                return self._json({"ok": True})
            return self._json({"error": "unknown"}, 404)
        except FileNotFoundError as e: return self._json({"error": str(e)}, 404)
        except Exception as e: return self._json({"error": str(e)}, 500)

    def do_PUT(self):
        path = unquote(urlparse(self.path).path)
        m = re.match(r"^/api/projects/([\w-]+)$", path)
        if not m: return self._json({"error": "unknown"}, 404)
        try:
            incoming = json.loads(self._body())
            with PLOCK:
                cur = load_proj(m.group(1))
                # media status is owned by the server (jobs) — keep server values, take client edits for the rest
                srv = {x["id"]: x for x in cur["media"]}
                incoming["media"] = [{**x, **{k: v for k, v in srv.get(x["id"], {}).items() if k in ("ready", "proxy", "wav", "thumb", "strip", "stripN", "peaks", "dur", "w", "h", "type", "img", "words", "hasAudio", "orig")}} for x in incoming.get("media", [])]
                save_proj(m.group(1), incoming)
            return self._json({"ok": True})
        except Exception as e: return self._json({"error": str(e)}, 500)

    def do_DELETE(self):
        m = re.match(r"^/api/projects/([\w-]+)$", unquote(urlparse(self.path).path))
        if m: shutil.rmtree(pdir(m.group(1)), ignore_errors=True); return self._json({"ok": True})
        return self._json({"error": "unknown"}, 404)

if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"Rattana Cut v{VERSION} -> http://localhost:{PORT}", flush=True)
    if "--no-browser" not in sys.argv: threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    srv.serve_forever()
