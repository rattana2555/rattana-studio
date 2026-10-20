# Rattana Studio

เครื่องมือทำวิดีโอของรัตนไพบูลย์ ทั้งหมดทำงานบนเครื่องตัวเอง ไม่เสียค่าบริการรายเดือน

| โฟลเดอร์ / ไฟล์ | คืออะไร |
|---|---|
| `rattana-cut/` | **Rattana Cut v1.1** แอปตัดต่อวิดีโอ: ไทม์ไลน์หลายแทร็ก คีย์เฟรม ข้อความ/ซับ ฟิลเตอร์ ทรานซิชัน ลบฉากเขียว สติกเกอร์ วาดรูป เสียง/เพลง ส่งออกถึง 4K + AI ถอดเสียงทำซับไทย ตัดช่วงเงียบ คลังออนไลน์ Pixabay/Freesound |
| `rattana-motion-studio.html` | Rattana Motion Studio v2.1 สร้างคลิปโมชันกราฟิกจากเทมเพลต (เปิดไฟล์ในเบราว์เซอร์ได้เลย) |
| `rattana-1min/` | ไฟล์งานคลิป "รัตนไพบูลย์ ใน 1 นาที" (หน้าเรนเดอร์ + สคริปต์จัดเวลา) |
| `skills/rattana-autoedit/` | สกิล Claude Code ตัดคลิปคนพูดหน้ากล้องอัตโนมัติ (คัดลอกไปไว้ที่ `%USERPROFILE%\.claude\skills\`) |
| `voice-colab/` | Notebook Google Colab โคลนเสียงพากย์ภาษาไทย (F5-TTS-THAI) |

ไฟล์วิดีโอ เสียง โปรเจกต์ และ API key **ไม่ได้อยู่ใน repo นี้** (ดู `.gitignore`)

## ติดตั้ง Rattana Cut บนเครื่องใหม่ (Windows)

ต้องมี: Windows 10/11, [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) ใน PATH, [Node.js 20+](https://nodejs.org), Google Chrome

1. ติดตั้ง Python 3.11 + แพ็กเกจ (ใช้ [uv](https://docs.astral.sh/uv/)):
   ```
   uv venv --python 3.11 %USERPROFILE%\.claude\video-tools\venv-f5
   uv pip install --python %USERPROFILE%\.claude\video-tools\venv-f5\Scripts\python.exe faster-whisper yt-dlp
   ```
2. ติดตั้ง Playwright สำหรับส่งออกวิดีโอ (ตัวส่งออกหา Playwright ที่ `%USERPROFILE%\.claude\skills\motion-broll\node_modules`):
   ```
   mkdir %USERPROFILE%\.claude\skills\motion-broll && cd %USERPROFILE%\.claude\skills\motion-broll && npm i playwright
   ```
3. (แนะนำ) โมเดลถอดเสียงภาษาไทย Thonburian Whisper แปลงเป็น CTranslate2 ไว้ที่ `%USERPROFILE%\.claude\video-tools\models\whisper-th-large-v3-ct2`
   ```
   ct2-transformers-converter --model biodatlab/whisper-th-large-v3-combined --output_dir %USERPROFILE%\.claude\video-tools\models\whisper-th-large-v3-ct2 --copy_files tokenizer.json preprocessor_config.json --quantization int8
   ```
   ถ้าไม่มี แอปจะใช้ Whisper large-v3 มาตรฐานแทน (ภาษาไทยแม่นน้อยกว่า)
4. (ไม่บังคับ) แยกเสียงพูดออกจากเพลง: venv `%USERPROFILE%\.claude\video-tools\venv-demucs` + `pip install demucs`
5. ดับเบิลคลิก `rattana-cut\start-rattana-cut.bat` → เปิด http://localhost:8765
6. ใส่ Pixabay / Freesound API key ที่ปุ่ม ⚙ ตั้งค่า (เก็บใน `rattana-cut/settings.json` ซึ่งไม่ถูกอัปขึ้น GitHub)

## เครดิต
- ซับภาษาไทย: [Thonburian Whisper](https://huggingface.co/biodatlab/whisper-th-large-v3-combined) (Apache-2.0), [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- เสียงเอฟเฟกต์ในตัว: คลัง CC0 จากสกิล sound-effects · คลังออนไลน์ผ่าน API ทางการของ [Pixabay](https://pixabay.com/api/docs/) และ [Freesound](https://freesound.org/docs/api/) (CC0)
- แรงบันดาลใจรายการฟีเจอร์: MyCut โดย CooRan (ไม่ได้ใช้โค้ดของ MyCut)
