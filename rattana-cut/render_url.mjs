// Rattana Cut v1.0 — export renderer: node render_url.mjs <url> <out.mp4> [fps]
// Opens the render page (window.VIDEO / seek(t) / buildAudio(ctx)), screenshots every frame into ffmpeg, mixes audio offline.
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(path.join(process.env.USERPROFILE || process.env.HOME, '.claude/skills/motion-broll/node_modules/playwright'));

const [, , url, out, fpsArg = '30'] = process.argv;
const fps = +fpsArg, WORKERS = 3;
const run = args => new Promise((res, rej) => { const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }); let e = ''; p.stderr.on('data', d => e += d); p.on('close', c => c ? rej(new Error(e.slice(-400))) : res()); });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });

async function open() {
  const probe = await browser.newPage(); await probe.goto(url); await probe.waitForFunction(() => window.VIDEO, null, { timeout: 120000 });
  const V = await probe.evaluate(() => window.VIDEO); await probe.close();
  const page = await browser.newPage({ viewport: { width: V.w, height: V.h }, deviceScaleFactor: 1 });
  await page.goto(url); await page.waitForFunction(() => window.VIDEO && window.seek, null, { timeout: 120000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  return { page, V };
}
const first = await open(); const V = first.V, N = Math.max(1, Math.round(V.duration * fps));
const base = out.replace(/\.mp4$/i, ''), segs = [];
let done = 0;
await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  const per = Math.ceil(N / WORKERS), a = w * per, b = Math.min(N, a + per); if (a >= b) return;
  const { page } = w === 0 ? first : await open();
  const seg = `${base}_seg${w}.mp4`; segs[w] = seg;
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=out_range=tv', '-crf', '17', '-preset', 'medium', seg], { stdio: ['pipe', 'ignore', 'inherit'] });
  const closed = new Promise(r => ff.on('close', r));
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.seek(t), f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (++done % 15 === 0) console.log(`PROGRESS ${done}/${N}`);
  }
  ff.stdin.end(); await closed; if (w) await page.close();
}));
const list = base + '_segs.txt'; writeFileSync(list, segs.filter(Boolean).map(s => `file '${path.resolve(s).replace(/'/g, "'\\''")}'`).join('\n'));
const silent = base + '_silent.mp4';
await run(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
segs.filter(Boolean).forEach(s => rmSync(s)); rmSync(list);
console.log('AUDIO mixing');
const b64 = await first.page.evaluate(async dur => {
  const sr = 48000, ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  await window.buildAudio(ctx);
  const buf = await ctx.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1);
  const i16 = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { i16[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767; i16[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767; }
  const u8 = new Uint8Array(i16.buffer); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}, V.duration);
const pcm = base + '.pcm'; writeFileSync(pcm, Buffer.from(b64, 'base64'));
await run(['-v', 'error', '-y', '-i', silent, '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', pcm, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
rmSync(pcm); rmSync(silent);
await browser.close();
console.log('DONE ' + out);
