# Builds timing.js (scene starts, VO offsets, phrase times) and vo.js (base64 VO) for rattana-1min.html  v1.0
import json, base64, re, subprocess, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
VO_DIR = os.path.join(HERE, "..", "voice-colab", "final")
PHRASES = {
  "s1": ["รัตนไพบูลย์", "ค้าส่ง", "กระจายสินค้า", "ค้าปลีก"],
  "s2": ["เราคือผู้กระจายสินค้าอุปโภคบริโภค", "ด้วยสี่คลัง", "กับอีกหนึ่งหน้าร้าน", "สินค้ากว่าสองหมื่นรายการ", "รถส่งหกสิบคัน", "และทีมงานราวสามร้อยคน"],
  "s3": ["คลังของเราอยู่ที่", "สมุทรสงคราม", "สุพรรณบุรี", "ราชบุรี", "และนครปฐม"],
  "s4": ["ทุกลังเดินทางเป็นระบบ", "จากซัพพลายเออร์", "เข้าคลัง", "เซลล์ยิงออเดอร์", "คลังจัดของ", "ขึ้นรถ", "ส่งถึงร้านค้า"],
  "s5": ["เบื้องหลังคือเว็บแอปกว่าหกสิบตัว", "ที่ทีมเราพัฒนาเอง", "และใช้จริงหน้างานทุกวัน"],
  "s6": ["และรัตนมาร์ท", "หน้าร้านของเราที่นครปฐม"],
  "s7": ["รัตนไพบูลย์"],
}
# captions shown on screen (numbers as digits)
CAPTION = {
  "s2": ["เราคือผู้กระจายสินค้าอุปโภคบริโภค", "ด้วย 4 คลัง", "กับอีก 1 หน้าร้าน", "สินค้ากว่า 20,000 รายการ", "รถส่ง 60 คัน", "และทีมงานราว 300 คน"],
  "s5": ["เบื้องหลังคือเว็บแอปกว่า 60 ตัว", "ที่ทีมเราพัฒนาเอง", "และใช้จริงหน้างานทุกวัน"],
}
LEAD = {"s1": .6, "s2": .5, "s3": .5, "s4": .4, "s5": .4, "s6": .5, "s7": .8}   # silence before VO in each scene
TAIL = {"s1": .9, "s2": .8, "s3": .8, "s4": 1.6, "s5": .5, "s6": .8, "s7": 2.0}   # hold after VO

def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())

words = json.load(open(os.path.join(VO_DIR, "words.json"), encoding="utf-8"))
norm = lambda s: re.sub(r"\s", "", s)
tm = {"start": [], "vo": {}, "voDur": {}, "ph": {}, "txt": {}}
t = 0.0
for s, phr in PHRASES.items():
    wav = os.path.join(VO_DIR, f"vo_{s}.wav"); d = dur(wav)
    ws = words[f"vo_{s}.wav"]
    # map phrase start (by character share of the script) onto whisper word timeline (by character share)
    # whisper writes numbers as digits, so measure the script the same way
    pn = lambda p: norm(p).replace("สองหมื่น", "20,000").replace("หกสิบ", "60").replace("สามร้อย", "300").replace("สี่", "4").replace("หนึ่ง", "1")
    total = sum(len(pn(p)) for p in phr); wtot = sum(len(norm(w["w"])) for w in ws) or 1
    cum, starts = 0, []
    for p in phr:
        r = cum / total; acc = 0; at = ws[0]["s"] if ws else 0
        for w in ws:
            if acc / wtot >= r - 1e-6: at = w["s"]; break
            acc += len(norm(w["w"]))
        starts.append(round(at if cum else min(at, .05), 2)); cum += len(pn(p))
    tm["start"].append(round(t, 2)); tm["vo"][s] = round(t + LEAD[s], 2); tm["voDur"][s] = round(d, 2)
    tm["ph"][s] = starts; tm["txt"][s] = CAPTION.get(s, phr)
    t += LEAD[s] + d + TAIL[s]
tm["total"] = round(t, 2)
open(os.path.join(HERE, "timing.js"), "w", encoding="utf-8").write("window.TM=" + json.dumps(tm, ensure_ascii=False) + ";\n")
vo = {s: base64.b64encode(open(os.path.join(VO_DIR, f"vo_{s}.wav"), "rb").read()).decode() for s in PHRASES}
open(os.path.join(HERE, "vo.js"), "w").write("window.VO=" + json.dumps(vo) + ";\n")
print(json.dumps(tm, ensure_ascii=False, indent=1))
