/* Rattana Cut v1.0 — editor app */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + Math.random().toString(36).slice(2, 9);
const clamp = RC.clamp;
const api = async (url, opt = {}) => { const r = await fetch(url, opt); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); return j; };
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
function toast(msg, bad) { document.querySelectorAll('.toast').forEach(x => x.remove()); const d = document.createElement('div'); d.className = 'toast' + (bad ? ' bad' : ''); d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }

let P = null, L = null, stage = null, T = 0, playing = false, sel = null, tab = 'media', pps = 60, snapOn = true, muted = false;
let HIST = [], HI = -1, saveTimer = null, histTimer = null;
const JOBS = {};   // jid -> {kind, mediaId, label, onDone}

/* ═════════ HOME ═════════ */
let PROJECTS = [];
async function loadHome() {
  try { $('ver').textContent = (await api('/api/info')).version; } catch {}
  PROJECTS = await api('/api/projects'); renderHome();
  const news = await api('/api/news').catch(() => []);
  $('newsList').innerHTML = news.length ? news.map(n => `<div class="it"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><div class="hint" style="margin-top:4px">${esc(n.date || '')}</div></div>`).join('') : '<div class="hint">ยังไม่มีประกาศ</div>';
}
function renderHome() {
  const q = ($('psearch').value || '').trim().toLowerCase();
  const list = PROJECTS.filter(p => !q || (p.name || '').toLowerCase().includes(q));
  $('pcount').textContent = `${list.length} โปรเจกต์`;
  $('plist').innerHTML = `<div class="newcard" onclick="newProjectDialog()"><div style="font-size:30px">＋</div><b>สร้างโปรเจกต์ใหม่</b></div>` + list.map(p => `
    <div class="pcard" onclick="openProject('${p.id}')"><div class="th" style="${p.thumb ? `background-image:url('${p.thumb}')` : ''}">${p.thumb ? '' : '🎬'}</div>
    <div class="bd"><div class="nm">${esc(p.name)}</div><div class="mt">${p.ratio || ''} · แก้ไข ${new Date((p.updated || 0) * 1000).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</div></div>
    <button class="del" title="ลบโปรเจกต์" onclick="event.stopPropagation();delProject('${p.id}')">🗑</button></div>`).join('');
}
function modal(html) { const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal">${html}</div>`; document.body.appendChild(bg); bg.addEventListener('mousedown', e => { if (e.target === bg && !bg.dataset.lock) bg.remove(); }); return bg; }
function newProjectDialog() {
  const m = modal(`<h3>สร้างโปรเจกต์ใหม่</h3><div><span class="lbl">ชื่อโปรเจกต์</span><input class="inp" id="npName" value="โปรเจกต์ใหม่"></div>
    <div><span class="lbl">สัดส่วนภาพ</span><div class="row" style="flex-wrap:wrap" id="npRatio">${Object.keys(RC.RATIOS).map((r, i) => `<button class="chip${i ? '' : ' on'}" data-r="${r}">${r}</button>`).join('')}</div></div>
    <div class="row" style="justify-content:flex-end"><button class="pill sm ol" onclick="this.closest('.modal-bg').remove()">ยกเลิก</button><button class="pill sm wh" id="npGo">สร้าง</button></div>`);
  m.querySelectorAll('#npRatio .chip').forEach(b => b.onclick = () => { m.querySelectorAll('#npRatio .chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  m.querySelector('#npGo').onclick = async () => { const p = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: m.querySelector('#npName').value, ratio: m.querySelector('#npRatio .on').dataset.r }) }); m.remove(); openProject(p.id); };
  setTimeout(() => m.querySelector('#npName').select(), 50);
}
async function delProject(id) { if (!confirm('ลบโปรเจกต์นี้ถาวร?')) return; await api(`/api/projects/${id}`, { method: 'DELETE' }); loadHome(); }
function openRcut() { $('fRcut').click(); }
$('fRcut').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const { job } = await api('/api/open-rcut', { method: 'POST', body: f });
  const m = jobModal('กำลังเปิดไฟล์โปรเจกต์', job, r => { m.remove(); openProject(r.id); });
};
function jobModal(title, jid, onDone) {
  const m = modal(`<h3>${title}</h3><div class="bigbar"><i id="jmBar" style="width:0"></i></div><div class="hint" id="jmMsg">เริ่มต้น...</div>`); m.dataset.lock = 1;
  const tick = async () => { const j = await api(`/api/jobs/${jid}`); m.querySelector('#jmBar').style.width = (j.progress || 0) + '%'; m.querySelector('#jmMsg').textContent = `${j.msg || ''} ${Math.round(j.progress || 0)}%`;
    if (j.state === 'done') onDone(j.result); else if (j.state === 'error') { m.querySelector('#jmMsg').textContent = '❌ ' + j.msg; m.dataset.lock = ''; } else setTimeout(tick, 700); };
  tick(); return m;
}

/* ═════════ PROJECT LOAD / SAVE / HISTORY ═════════ */
async function openProject(id) {
  P = await api(`/api/projects/${id}`);
  P.items ||= []; P.audio ||= []; P.main ||= []; P.settings ||= { duck: true };
  $('home').classList.add('hidden'); $('editor').classList.remove('hidden');
  $('pname').value = P.name; $('ratio').value = P.ratio;
  HIST = []; HI = -1; snapshot(); sel = null; T = 0;
  rebuildStage(); renderTabs(); renderLeft(); renderInsp(); renderTL(); fitStage();
  for (const m of P.media) if (!m.ready) pollMedia();
}
function goHome() { if (stage) stage.stopAll(); playing = false; saveNow(); $('editor').classList.add('hidden'); $('home').classList.remove('hidden'); loadHome(); }
const strip = () => JSON.stringify({ ...P, media: P.media.map(m => ({ id: m.id, name: m.name })) });
function snapshot() { const s = strip(); if (HIST[HI] === s) return; HIST = HIST.slice(0, HI + 1); HIST.push(s); if (HIST.length > 80) HIST.shift(); HI = HIST.length - 1; updUndo(); }
function restore(s) { const o = JSON.parse(s), media = P.media; P = { ...o, media }; afterStruct(); }
function undo() { clearTimeout(histTimer); snapshot(); if (HI > 0) { HI--; restore(HIST[HI]); toast('ย้อนกลับ'); } updUndo(); }
function redo() { if (HI < HIST.length - 1) { HI++; restore(HIST[HI]); toast('ทำซ้ำ'); } updUndo(); }
function updUndo() { $('bUndo').disabled = HI <= 0; $('bRedo').disabled = HI >= HIST.length - 1; }
function changed(soft) {
  $('saveSt').innerHTML = '<i class="dot" style="background:var(--warn);box-shadow:none"></i>กำลังบันทึก...';
  clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700);
  if (soft) { clearTimeout(histTimer); histTimer = setTimeout(snapshot, 500); } else snapshot();
}
async function saveNow() {
  if (!P) return; clearTimeout(saveTimer);
  try { await api(`/api/projects/${P.id}`, { method: 'PUT', body: JSON.stringify(P) }); $('saveSt').innerHTML = '<i class="dot"></i>บันทึกอัตโนมัติแล้ว'; }
  catch (e) { $('saveSt').innerHTML = '<i class="dot" style="background:var(--bad)"></i>บันทึกไม่สำเร็จ'; }
}
function afterStruct() { L = RC.layout(P); stage.setProject(P); renderTL(); renderInsp(); drawNow(); }

/* ═════════ STAGE ═════════ */
function rebuildStage() { $('stageHost').innerHTML = ''; stage = new RC.Stage($('stageHost'), P, { mode: 'preview' }); L = RC.layout(P); fitStage(); drawNow(); }
let SCALE = 1;
function fitStage() {
  if (!stage) return; const w = $('stageWrap'), aw = w.clientWidth - 40, ah = w.clientHeight - 30;
  SCALE = Math.min(aw / stage.W, ah / stage.H); $('stageHost').style.transform = `scale(${SCALE})`;
  Object.assign($('stageBox').style, { width: stage.W * SCALE + 'px', height: stage.H * SCALE + 'px' });
  const dl = $('drawLayer'); dl.width = stage.W * SCALE; dl.height = stage.H * SCALE; updSelBox();
}
new ResizeObserver(fitStage).observe(document.getElementById('stageWrap'));
function drawNow() { if (!stage) return; stage.draw(T, playing); $('tc').innerHTML = `<b>${fmt(T)}</b> / ${fmt(L.total)}`; updPlayhead(); updSelBox(); }

/* ═════════ PLAYBACK ═════════ */
let lastNow = 0, AC = null, audioEls = {}, sfxBuf = {};
function ensureAC() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); }
function togglePlay() { playing ? pause() : play(); }
function play() { ensureAC(); if (T >= L.total - .02) T = 0; playing = true; $('bPlay').textContent = '❚❚'; lastNow = performance.now(); requestAnimationFrame(loop); }
function pause() { playing = false; $('bPlay').textContent = '▶'; stage.stopAll(); Object.values(audioEls).forEach(a => a.pause()); drawNow(); }
function seek(t) { T = clamp(t, 0, L.total); if (playing) syncAudio(true); drawNow(); }
function loop(now) {
  if (!playing) return;
  const dt = Math.min(.1, (now - lastNow) / 1000); lastNow = now; const t0 = T;
  T = Math.min(L.total, T + dt);
  for (const x of P.audio) if (x.kind === 'sfx' && x.s > t0 && x.s <= T) playSfx(x);
  syncAudio(); drawNow();
  if (T >= L.total) { pause(); return; }
  requestAnimationFrame(loop);
}
function syncAudio(force) {
  const speech = L.clips.some(cl => T >= cl.start && T < cl.end && cl.m && cl.m.hasAudio && (cl.c.vol ?? 1) > 0);
  for (const x of P.audio) {
    if (x.kind === 'sfx') continue;
    const m = L.mediaById[x.mediaId]; if (!m || !m.wav) continue;
    let a = audioEls[x.id]; if (!a) { a = audioEls[x.id] = new Audio(`/projects/${P.id}/media/${m.wav}`); a.preload = 'auto'; }
    const d = RC.itemDur(x), on = T >= x.s && T < x.s + d, sp = x.speed || 1;
    if (!on || muted) { if (!a.paused) a.pause(); continue; }
    const mt = (x.in || 0) + (T - x.s) * sp; a.playbackRate = sp;
    let v = x.vol ?? (x.kind === 'music' ? .35 : 1); if (x.kind === 'music' && x.duck !== false && P.settings.duck !== false && speech) v *= .28;
    a.volume = clamp(v);
    if (force || Math.abs(a.currentTime - mt) > .3) a.currentTime = mt;
    if (a.paused) a.play().catch(() => {});
  }
  stage.root.querySelectorAll('video').forEach(v => v.muted = muted || v.closest('.rc-ov') != null);
}
async function playSfx(x) {
  if (muted) return; ensureAC();
  try { if (!sfxBuf[x.file]) sfxBuf[x.file] = await fetch('/sfx/' + x.file).then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b));
    const s = AC.createBufferSource(), g = AC.createGain(); g.gain.value = x.vol ?? .7; s.buffer = sfxBuf[x.file]; s.connect(g).connect(AC.destination); s.start(); } catch {}
}
function toggleMute() { muted = !muted; $('bMute').textContent = muted ? '🔇' : '🔊'; syncAudio(); }
function fullPreview() { const b = $('stageWrap'); document.fullscreenElement ? document.exitFullscreen() : b.requestFullscreen?.(); }
document.addEventListener('fullscreenchange', () => setTimeout(fitStage, 60));

/* ═════════ SELECTION ═════════ */
function findSel() {
  if (!sel) return null;
  const arr = sel.t === 'main' ? P.main : sel.t === 'item' ? P.items : P.audio;
  return arr.find(x => x.id === sel.id) || null;
}
function select(t, id) { sel = t ? { t, id } : null; renderTL(); renderInsp(); updSelBox(); if (tab === 'fx' || tab === 'trans') renderLeft(); }
function updSelBox() {
  const b = $('selBox'), x = sel && sel.t === 'item' ? findSel() : null;
  if (!x || !stage || T < x.s || T >= x.e || x.kind === 'draw') { b.style.display = 'none'; return; }
  const el = stage.els[x.id]; if (!el) { b.style.display = 'none'; return; }
  const k = RC.kfAt(x, T - x.s), w = el.offsetWidth * k.sc * SCALE, h = el.offsetHeight * k.sc * SCALE;
  Object.assign(b.style, { display: 'block', left: k.x * stage.W * SCALE - w / 2 + 'px', top: k.y * stage.H * SCALE - h / 2 + 'px', width: w + 'px', height: h + 'px', transform: `rotate(${k.rot + (x.tilt || 0)}deg)` });
}
/* drag items directly on the stage */
$('stageBox').addEventListener('pointerdown', e => {
  if (e.target.id === 'drawLayer' || e.target.id === 'selScale') return;
  const r = $('stageBox').getBoundingClientRect(), px = (e.clientX - r.left) / SCALE, py = (e.clientY - r.top) / SCALE;
  // hit-test visible items top-down
  const hits = (P.items || []).filter(x => x.kind !== 'draw' && T >= x.s && T < x.e).sort((a, b) => (b.lane || 0) - (a.lane || 0));
  const hit = hits.find(x => { const el = stage.els[x.id]; if (!el) return false; const k = RC.kfAt(x, T - x.s), w = el.offsetWidth * k.sc / 2, h = el.offsetHeight * k.sc / 2; return Math.abs(px - k.x * stage.W) < w && Math.abs(py - k.y * stage.H) < h; });
  if (!hit) { if (sel && sel.t === 'item') select(null); return; }
  if (!sel || sel.id !== hit.id) select('item', hit.id);
  const k0 = RC.kfAt(hit, T - hit.s), sx = e.clientX, sy = e.clientY;
  const mv = ev => { setProp(hit, { x: clamp(k0.x + (ev.clientX - sx) / SCALE / stage.W, -.2, 1.2), y: clamp(k0.y + (ev.clientY - sy) / SCALE / stage.H, -.2, 1.2) }); drawNow(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); changed(); renderInsp(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
$('selScale').addEventListener('pointerdown', e => {
  e.stopPropagation(); const x = findSel(); if (!x) return; const k0 = RC.kfAt(x, T - x.s), sy = e.clientY;
  const mv = ev => { setProp(x, { sc: clamp(k0.sc * (1 + (ev.clientY - sy) / 200), .1, 8) }); drawNow(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); changed(); renderInsp(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
/* set transform props: if the item has keyframes, write into the keyframe at the playhead */
function setProp(x, o) {
  if (x.kf && x.kf.length) { const lt = Math.round((T - x.s) * 20) / 20; let k = x.kf.find(k => Math.abs(k.t - lt) < .03); if (!k) { k = { t: lt, ...RC.kfAt(x, lt) }; x.kf.push(k); } Object.assign(k, o); }
  else Object.assign(x, o);
}
function addKf() {
  const x = findSel(); if (!x || sel.t !== 'item') return toast('เลือกข้อความ/สติกเกอร์/ภาพซ้อนก่อน', true);
  if (T < x.s || T > x.e) return toast('เลื่อนหัวอ่านให้อยู่ในช่วงของชิ้นงานก่อน', true);
  x.kf ||= []; const lt = Math.round((T - x.s) * 20) / 20;
  if (!x.kf.find(k => Math.abs(k.t - lt) < .03)) x.kf.push({ t: lt, ...RC.kfAt(x, lt) });
  changed(); renderTL(); renderInsp(); toast('เพิ่มคีย์เฟรมแล้ว ลากชิ้นงานบนจอเพื่อกำหนดตำแหน่งที่จุดนี้');
}

/* ═════════ LEFT PANEL ═════════ */
const TABS = [['media', 'สื่อ'], ['stock', '🌐 คลังออนไลน์'], ['text', 'ข้อความ'], ['sticker', 'สติกเกอร์'], ['fx', 'เอฟเฟกต์'], ['trans', 'ทรานซิชัน'], ['audio', 'เสียง'], ['ai', '✨ AI']];
let stockKind = 'music', stockQ = '', stockRes = null, recentDl = null;
function renderTabs() { $('tabs').innerHTML = TABS.map(([k, n]) => `<button class="chip${tab === k ? ' on' : ''}" onclick="tab='${k}';renderTabs();renderLeft()">${n}</button>`).join(''); }
let mediaSort = 'date', SFX = null, sfxCat = 'whoosh', stkCat = Object.keys(RC.STICKERS)[0];
function renderLeft() {
  const lp = $('lp'); let h = '';
  if (tab === 'media') {
    const ms = P.media.slice().sort((a, b) => mediaSort === 'name' ? a.name.localeCompare(b.name, 'th') : mediaSort === 'len' ? (b.dur || 0) - (a.dur || 0) : 0);
    h = `<div class="row"><button class="pill sm wh" onclick="$('fImport').click()">＋ นำเข้าไฟล์</button><select class="inp" style="height:32px;width:auto" onchange="mediaSort=this.value;renderLeft()"><option value="date"${mediaSort === 'date' ? ' selected' : ''}>เรียง: วันที่</option><option value="name"${mediaSort === 'name' ? ' selected' : ''}>ชื่อ</option><option value="len"${mediaSort === 'len' ? ' selected' : ''}>ความยาว</option></select></div>
      <div class="drop" id="drop">ลากไฟล์วิดีโอ / รูป / เพลง มาวางตรงนี้ (เลือกได้ทีละหลายร้อยไฟล์)</div>
      <div class="mgrid">${ms.map(m => mediaCard(m)).join('') || '<div class="hint">ยังไม่มีสื่อ</div>'}</div>
      <div class="card"><h4>🔗 ดาวน์โหลดจากลิงก์</h4><div class="row"><input class="inp" id="dlUrl" placeholder="วางลิงก์ YouTube / Facebook ..."><button class="pill sm ol" onclick="downloadUrl()">โหลด</button></div><div class="hint">ใช้กับคลิปที่คุณมีสิทธิ์ใช้งานเท่านั้น</div></div>`;
  } else if (tab === 'stock') {
    const kinds = [['music', '🎵 เพลง'], ['sfx', '🔊 เอฟเฟกต์เสียง'], ['video', '🎬 วิดีโอ'], ['image', '🖼 รูปภาพ']];
    h = `<div class="row" style="flex-wrap:wrap">${kinds.map(([k, n]) => `<button class="chip${stockKind === k ? ' on' : ''}" onclick="stockKind='${k}';stockRes=null;renderLeft()">${n}</button>`).join('')}</div>
      <div class="row"><input class="inp" id="stockQ" placeholder="ค้นหา เช่น happy, whoosh, market..." value="${esc(stockQ)}" onkeydown="if(event.key==='Enter')stockSearch()"><button class="pill sm wh" onclick="stockSearch()">ค้นหา</button></div>`;
    if (stockKind === 'music' || stockKind === 'sfx') {
      h += `<div class="card"><h4>Pixabay ${stockKind === 'music' ? 'Music' : 'Sound Effects'}</h4>
        <div class="hint">Pixabay ไม่มี API ทางการสำหรับเสียง จึงเปิดหน้าค้นหาของ Pixabay ให้กดดาวน์โหลดเอง (ฟรี ใช้เชิงพาณิชย์ได้) แล้วกลับมากด "นำเข้า" ด้านล่าง ไฟล์ในโฟลเดอร์ Downloads จะขึ้นให้อัตโนมัติ</div>
        <button class="pill sm ol" onclick="openPixabaySite()">🔎 เปิดค้นหาใน Pixabay</button></div>
        <div class="card"><h4>📥 ไฟล์ที่เพิ่งดาวน์โหลด <button class="ib" style="width:28px;height:28px;margin-left:auto" onclick="loadRecent()">⟳</button></h4>
        <div class="sfxl">${recentDl ? (recentDl.length ? recentDl.map(f => `<div class="s"><span title="${esc(f.name)}">${esc(f.name)}</span><span class="hint" style="flex:0">${Math.round((Date.now() / 1000 - f.mtime) / 60)} นาที</span><button class="pill sm ol" style="height:26px" onclick="importDownload('${esc(f.name).replace(/'/g, "\\'")}')">นำเข้า</button></div>`).join('') : '<div class="hint">ยังไม่มีไฟล์ใหม่ใน 6 ชั่วโมงที่ผ่านมา</div>') : '<div class="hint">กำลังโหลด...</div>'}</div></div>`;
      if (stockKind === 'sfx') h += `<div class="card"><h4>Freesound (CC0) — ค้นหาและใส่ในแอปได้เลย</h4>${stockRes && stockRes.error ? `<div class="hint">${esc(stockRes.error)}</div>` : ''}
        <div class="sfxl">${stockRes && stockRes.hits ? stockRes.hits.map(h2 => `<div class="s"><button class="ib" style="width:28px;height:28px" onclick="previewUrl('${h2.url}')">▶</button><span title="${esc(h2.name)} · ${esc(h2.user)}">${esc(h2.name)}</span><span class="hint" style="flex:0">${h2.dur}s</span><button class="pill sm ol" style="height:26px" onclick="importUrl('${h2.url}','${esc(h2.name).replace(/'/g, '')}.mp3','sfx')">＋</button></div>`).join('') || '<div class="hint">ไม่พบผลลัพธ์</div>' : '<div class="hint">พิมพ์คำค้นภาษาอังกฤษ แล้วกดค้นหา</div>'}</div></div>`;
      if (!recentDl) loadRecent();
    } else {
      h += stockRes && stockRes.error ? `<div class="hint">${esc(stockRes.error)}</div>` : '';
      h += `<div class="mgrid">${stockRes && stockRes.hits ? stockRes.hits.map(h2 => `<div class="mi" onclick="importUrl('${h2.url}','pixabay-${h2.id}.${stockKind === 'video' ? 'mp4' : 'jpg'}')" title="โดย ${esc(h2.user)} · คลิกเพื่อนำเข้า"><div class="im" style="background-image:url('${h2.thumb}')"></div>${h2.dur ? `<span class="du">${h2.dur}s</span>` : ''}<div class="nm">📷 ${esc(h2.user)} · Pixabay</div></div>`).join('') : '<div class="hint">ค้นหาวิดีโอ/รูปฟรีจาก Pixabay (ต้องใส่ API key ฟรีใน ⚙ ตั้งค่า)</div>'}</div>`;
    }
    h += `<div class="hint">ภาพ/วิดีโอ/เสียงจาก Pixabay และ Freesound (CC0) ใช้ได้ฟรี · <a href="#" onclick="settingsDialog();return false" style="color:#fff">⚙ ตั้งค่า API key</a></div>`;
  } else if (tab === 'text') {
    h = `<button class="pill sm wh" onclick="addText()">＋ เพิ่มข้อความ</button><span class="lbl">สไตล์สำเร็จรูป (คลิกเพื่อเพิ่ม / ใช้กับข้อความที่เลือก)</span>
      <div class="tgrid">${Object.entries(RC.TEXT_PRESETS).map(([k, s]) => `<div class="tp" onclick="applyPreset('${k}')" style="background:${k === 'gold' ? '#0b1530' : '#3a3a40'}"><span style="${presetPreview(s)}">${esc(s.name)}</span></div>`).join('')}</div>
      <span class="lbl">แอนิเมชันทีละตัวอักษร</span><div class="row" style="flex-wrap:wrap">${Object.entries(RC.TEXT_ANIMS).map(([k, n]) => `<button class="chip" onclick="setTextAnim('${k}')">${n}</button>`).join('')}</div>
      <div class="hint">เลือกข้อความบนไทม์ไลน์ก่อน แล้วกดแอนิเมชัน หรือแก้ฟอนต์ สี ขอบ เงา เรืองแสง ได้ที่แผงขวา</div>`;
  } else if (tab === 'sticker') {
    h = `<div class="row" style="flex-wrap:wrap">${Object.keys(RC.STICKERS).map(c => `<button class="chip${c === stkCat ? ' on' : ''}" onclick="stkCat='${c}';renderLeft()">${c}</button>`).join('')}</div>
      <div class="sgrid">${RC.STICKERS[stkCat].map(e => `<button onclick="addSticker('${e}')">${e}</button>`).join('')}</div>
      <div class="card"><h4>✏️ วาดรูป</h4><div class="row" style="flex-wrap:wrap" id="drawTools">${[['brush', '🖌 พู่กัน'], ['hl', '🖍 ไฮไลต์'], ['line', '／ เส้นตรง'], ['arrow', '➜ ลูกศร']].map(([k, n]) => `<button class="chip${drawTool === k ? ' on' : ''}" onclick="drawTool='${k}';renderLeft()">${n}</button>`).join('')}</div>
      <div class="row"><input type="color" value="${drawColor}" onchange="drawColor=this.value"><span class="lbl" style="margin:0">ขนาด</span><input type="range" min="3" max="40" value="${drawW}" oninput="drawW=+this.value"></div>
      <button class="pill sm ${drawing ? 'wh' : 'ol'}" onclick="toggleDraw()">${drawing ? '✔ เสร็จสิ้นการวาด' : 'เริ่มวาดบนจอ'}</button><div class="hint">ลากเมาส์บนภาพเพื่อวาด จะได้ชิ้นงาน "วาดรูป" ยาว 3 วินาทีที่หัวอ่าน</div></div>`;
  } else if (tab === 'fx') {
    const c = sel && sel.t === 'main' ? findSel() : null, it = sel && sel.t === 'item' ? findSel() : null;
    if (it && it.kind === 'media') {
      const ch = it.chroma || {};
      h = `<div class="card"><h4>🟩 ลบฉากเขียว</h4><label class="row"><input type="checkbox" ${ch.on ? 'checked' : ''} onchange="chroma('on',this.checked)"> เปิดใช้</label>
        <div class="row"><span class="lbl" style="margin:0">สีที่จะลบ</span><input type="color" value="${ch.color || '#00ff00'}" onchange="chroma('color',this.value)"></div>
        ${rng('ความใกล้สี', 'chroma', 'tol', ch.tol ?? .35, 0, 1, .01)}${rng('ขอบนุ่ม', 'chroma', 'soft', ch.soft ?? .1, 0, .5, .01)}</div>`;
    } else if (!c) h = '<div class="hint">เลือกคลิปบนแทร็กหลักก่อน เพื่อใส่ฟิลเตอร์และปรับสี<br>หรือเลือกภาพซ้อน เพื่อลบฉากเขียว</div>';
    else {
      const f = c.filter || {}, th = (L.mediaById[c.mediaId] || {}).thumb;
      h = `<span class="lbl">ฟิลเตอร์ 10 แบบ</span><div class="fgrid">${Object.entries(RC.FILTERS).map(([k, x]) => `<div class="fp${(f.preset || 'none') === k ? ' on' : ''}" onclick="setFilter('preset','${k}')"><div class="im" style="background-image:url('/projects/${P.id}/media/${th}');filter:${x.css}"></div>${x.name}</div>`).join('')}</div>
        <div class="card"><h4>ปรับแสงและสี</h4>${rng('ความสว่าง', 'filter', 'b', f.b ?? 1, .4, 1.8, .01)}${rng('คอนทราสต์', 'filter', 'c', f.c ?? 1, .4, 1.8, .01)}${rng('ความอิ่มสี', 'filter', 's', f.s ?? 1, 0, 2.5, .01)}${rng('อุณหภูมิสี', 'filter', 'temp', f.temp ?? 0, -1, 1, .01)}
        <button class="pill sm ol" onclick="setFilter('reset')">รีเซ็ต</button></div>
        <div class="card"><h4>🔍 ซูมเข้า (Punch-in)</h4><button class="pill sm ol" onclick="addZoom()">＋ ซูมเข้าที่หัวอ่าน 1.5 วิ</button><div class="hint">${(c.zooms || []).length} จุดซูมในคลิปนี้</div>${(c.zooms || []).length ? '<button class="pill sm ol" onclick="clearZooms()">ลบจุดซูมทั้งหมด</button>' : ''}</div>`;
    }
  } else if (tab === 'trans') {
    const c = sel && sel.t === 'main' ? findSel() : null;
    h = `<span class="lbl">ทรานซิชัน 13 แบบ — ลากไปวางที่รอยต่อคลิปบนไทม์ไลน์ หรือเลือกคลิปแล้วคลิก</span>
      <div class="tgrid">${Object.entries(RC.TRANS).map(([k, n]) => `<div class="tp${c && (c.trans?.type || 'none') === k ? ' on' : ''}" draggable="true" ondragstart="event.dataTransfer.setData('trans','${k}')" onclick="setTrans('${k}')" style="font-size:14px;font-weight:600">${transIcon(k)} ${n}</div>`).join('')}</div>
      ${c ? `<div class="card">${rng('ความยาวทรานซิชัน (วิ)', 'trans', 'dur', c.trans?.dur ?? .5, .1, 2, .05)}<button class="pill sm ol" onclick="setTransAll()">ใช้กับทุกรอยต่อ</button></div>` : '<div class="hint">ทรานซิชันจะเกิดตอน "เข้า" คลิปที่เลือก</div>'}`;
  } else if (tab === 'audio') {
    if (!SFX) api('/api/sfx').then(s => { SFX = s; if (tab === 'audio') renderLeft(); });
    const cats = SFX ? [...new Set(SFX.map(s => s.cat))] : [];
    h = `<div class="row"><button class="pill sm wh" onclick="$('fMusic').click()">🎵 นำเข้าเพลง / เสียง</button><button class="pill sm ${rec ? 'wh' : 'ol'}" onclick="toggleRec()">${rec ? '⏹ หยุดอัด' : '🎙 อัดเสียงพากย์'}</button></div>
      ${rec ? '<div class="job"><span class="dot" style="background:var(--bad);box-shadow:0 0 10px var(--bad)"></span>กำลังอัดเสียงจากไมค์...</div>' : ''}
      <label class="row hint"><input type="checkbox" ${P.settings.duck !== false ? 'checked' : ''} onchange="P.settings.duck=this.checked;changed()"> หรี่เพลงอัตโนมัติตอนมีคนพูด</label>
      <span class="lbl">คลังเอฟเฟกต์เสียง (CC0) — ▶ ฟัง, ＋ ใส่ที่หัวอ่าน</span>
      <div class="row" style="flex-wrap:wrap">${cats.map(c => `<button class="chip${c === sfxCat ? ' on' : ''}" onclick="sfxCat='${c}';renderLeft()">${c}</button>`).join('')}</div>
      <div class="sfxl">${SFX ? SFX.filter(s => s.cat === sfxCat).map(s => `<div class="s"><button class="ib" style="width:28px;height:28px" onclick="previewSfx('${s.file}')">▶</button><span>${esc(s.name)}</span><button class="pill sm ol" style="height:26px" onclick="addSfx('${s.file}')">＋</button></div>`).join('') : '<div class="hint">กำลังโหลด...</div>'}</div>
      <div class="card"><h4>🗣 เสียงพากย์ AI (เสียงโคลน)</h4><div class="hint">สร้างไฟล์เสียงจาก Colab (voice-colab) แล้วนำเข้าที่ปุ่ม "นำเข้าเพลง / เสียง" ด้านบน แล้วตั้งชนิดเป็น "เสียงพากย์"</div></div>`;
  } else if (tab === 'ai') {
    const c = sel && sel.t === 'main' ? findSel() : null, cm = c && L.mediaById[c.mediaId];
    h = `<div class="card"><h4><span class="ai-badge">AI</span> ซับไตเติลอัตโนมัติ</h4>
        <div class="hint">AI ฟังเสียงในทุกคลิปบนแทร็กหลัก แล้วสร้างซับไทยไล่สีทีละคำแบบ CapCut (ใช้โมเดลภาษาไทย ประมาณ 6–7 นาทีต่อเสียง 1 นาที)</div>
        <div class="grid2"><div><span class="lbl">สไตล์ซับ</span><select class="inp" id="capStyle">${Object.entries(RC.TEXT_PRESETS).map(([k, s]) => `<option value="${k}"${k === 'pop' ? ' selected' : ''}>${s.name}</option>`).join('')}</select></div>
        <div><span class="lbl">ตัวอักษร/บรรทัด</span><input class="inp" id="capChars" type="number" value="14" min="6" max="30"></div></div>
        <label class="row hint"><input type="checkbox" id="capDemucs"> เสียงมีเพลงคลอ (แยกเสียงพูดก่อน ช้าขึ้น แม่นขึ้น)</label>
        <label class="row hint"><input type="checkbox" id="capHl" checked> ไฮไลต์ตัวเลข ราคา วันที่ อัตโนมัติ</label>
        <div><span class="lbl">คำเฉพาะในคลิปนี้ (ชื่อร้าน สินค้า สถานที่) — ซับจะไม่หั่นคำเหล่านี้</span><input class="inp" id="capGloss" value="${esc(P.settings.glossary ?? (window.GLOSS_DEF || GLOSS))}" onchange="P.settings.glossary=this.value;changed(true)"></div>
        <label class="row hint"><input type="checkbox" id="capRedo"> ถอดเสียงใหม่ (ใช้เมื่อเปลี่ยนคำเฉพาะ หรือผลเดิมผิดมาก)</label>
        <button class="pill sm wh" onclick="autoCaptions()">✨ สร้างซับอัตโนมัติ</button></div>
      <div class="card"><h4>📝 มีสคริปต์อยู่แล้ว? ให้ AI จัดเวลาให้</h4>
        <div class="hint">วางบทพูดที่ถูกต้อง (ขึ้นบรรทัดใหม่ = ขึ้นซับใหม่) AI จะจับคู่กับจังหวะเสียงพูดจริง คำในซับจะตรง 100%</div>
        <textarea class="inp" id="capScript" placeholder="พี่น้องนครปฐมทุกท่าน เตรียมตัวให้พร้อม&#10;โครงการไทยช่วยไทย ลดค่าครองชีพ..." style="min-height:110px">${esc(P.settings.script || '')}</textarea>
        <button class="pill sm ol" onclick="alignScript()">🎯 จัดเวลาสคริปต์ให้ตรงเสียง</button></div>
      ${P.items.some(x => x.auto) ? `<div class="card"><h4>✏️ แก้ซับทั้งหมด (${P.items.filter(x => x.auto).length} ท่อน)</h4><div class="sfxl" style="max-height:300px">${P.items.filter(x => x.auto).sort((a, b) => a.s - b.s).map(x => `<div class="s" style="align-items:flex-start"><button class="ib" style="width:44px;height:26px;font-size:11px" onclick="seek(${x.s});select('item','${x.id}')">${fmt(x.s).slice(0, 5)}</button><input class="inp" style="height:30px;font-size:13px" value="${esc(x.words ? x.words.map(w => (w.br ? ' / ' : '') + w.t).join('') : x.text)}" onchange="editCap('${x.id}',this.value)"></div>`).join('')}</div><div class="hint">ใช้ " / " เพื่อขึ้นบรรทัดที่ 2</div></div>` : ''}
      <div class="card"><h4><span class="ai-badge">AI</span> ตัดช่วงเงียบอัตโนมัติ</h4>
        <div class="hint">${c ? `คลิปที่เลือก: ${esc(cm?.name || '')}${cm?.words ? ' ✓ ถอดเสียงแล้ว' : ''}` : 'เลือกคลิปบนแทร็กหลักก่อน'}</div>
        ${rng2('เงียบนานกว่า (วิ)', 'silGap', silGap, .2, 2, .05)}
        <label class="row hint"><input type="checkbox" id="silPunch" checked> ซูมสลับทุกจุดตัด (กันภาพกระตุก)</label>
        <button class="pill sm ol" ${c ? '' : 'disabled'} onclick="cutSilence()">✂ ตัดช่วงเงียบ</button></div>
      <div class="card"><h4><span class="ai-badge">AI</span> ซูมเข้าคำสำคัญ</h4><div class="hint">ใส่ซูมตรงคำที่ไฮไลต์ในซับ (ตัวเลข ราคา วันที่)</div><button class="pill sm ol" onclick="autoZoomKeywords()">🔍 ใส่ซูมอัตโนมัติ</button></div>
      <div id="jobList"></div>`;
  }
  lp.innerHTML = h; renderJobs();
  const drop = $('drop');
  if (drop) { drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over'); drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); importFiles([...e.dataTransfer.files]); }; }
}
let silGap = .45;
const rng = (label, group, key, val, min, max, step) => `<div class="kv"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" oninput="setGroup('${group}','${key}',+this.value);this.nextElementSibling.value=(+this.value).toFixed(2)"><output>${(+val).toFixed(2)}</output></div>`;
const rng2 = (label, v, val, min, max, step) => `<div class="kv"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" oninput="${v}=+this.value;this.nextElementSibling.value=(+this.value).toFixed(2)"><output>${(+val).toFixed(2)}</output></div>`;
function presetPreview(s) { return `font-family:'${s.font}';font-weight:${s.weight};font-size:18px;${s.grad ? `background:linear-gradient(180deg,${s.grad[0]},${s.grad[1]});-webkit-background-clip:text;color:transparent;` : `color:${s.color};`}${s.bg ? `background:${s.bg};padding:2px 10px;border-radius:8px;` : ''}${s.stroke ? `-webkit-text-stroke:${Math.max(1, s.strokeW * 18)}px ${s.stroke};paint-order:stroke fill;` : ''}${s.glow ? `text-shadow:0 0 8px ${s.glow},0 0 16px ${s.glow};` : ''}${s.tilt ? `transform:rotate(${s.tilt}deg);display:inline-block;` : ''}`; }
const transIcon = k => ({ none: '⊘', fade: '◐', black: '■', white: '□', slideL: '←', slideR: '→', slideU: '↑', slideD: '↓', zoom: '⊕', zoomOut: '⊖', blur: '≋', spin: '⟳', wipe: '▍', circle: '◯' }[k] || '•');
function mediaCard(m) {
  const j = Object.values(JOBS).find(j => j.mediaId === m.id && j.kind === 'import');
  const bg = m.thumb ? `background-image:url('/projects/${P.id}/media/${m.thumb}')` : '';
  return `<div class="mi" onclick="addMedia('${m.id}')" title="คลิกเพื่อเพิ่มลงไทม์ไลน์"><div class="im" style="${bg}">${m.thumb ? '' : m.type === 'audio' ? '🎵' : '⏳'}</div>
    ${m.ready ? `<span class="du">${m.dur ? fmt(m.dur).slice(0, 5) : ''}</span>` : `<div class="pg"><i style="width:${j ? j.progress : 3}%"></i></div>`}
    <div class="acts">${m.ready && m.type !== 'audio' ? `<button onclick="event.stopPropagation();addOverlay('${m.id}')">ซ้อนภาพ</button>` : ''}${m.ready && m.type === 'video' ? `<button onclick="event.stopPropagation();addMedia('${m.id}','audio')">แยกเสียง</button>` : ''}</div>
    <div class="nm">${m.words ? '💬 ' : ''}${esc(m.name)}</div></div>`;
}

/* ═════════ IMPORT ═════════ */
$('fImport').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
$('fMusic').onchange = e => { importFiles([...e.target.files], 'music'); e.target.value = ''; };
async function importFiles(files, as) {
  for (const f of files) {
    try {
      const r = await api(`/api/projects/${P.id}/import`, { method: 'POST', headers: { 'X-Filename': encodeURIComponent(f.name) }, body: f });
      P.media.push(r.media); JOBS[r.job] = { kind: 'import', mediaId: r.media.id, label: f.name, progress: 0, as, at: T };
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + f.name, true); }
  }
  renderLeft(); pollJobs(); toast(`กำลังนำเข้า ${files.length} ไฟล์`);
}
async function downloadUrl() {
  const url = $('dlUrl').value.trim(); if (!url) return;
  const r = await api(`/api/projects/${P.id}/download`, { method: 'POST', body: JSON.stringify({ url }) });
  JOBS[r.job] = { kind: 'download', label: 'ดาวน์โหลดจากลิงก์', progress: 0 }; pollJobs(); toast('เริ่มดาวน์โหลด');
}
let polling = false;
function pollMedia() { pollJobs(); }
async function pollJobs() {
  if (polling) return; polling = true;
  while (Object.keys(JOBS).length || (P && P.media.some(m => !m.ready))) {
    for (const [jid, info] of Object.entries(JOBS)) {
      const j = await api(`/api/jobs/${jid}`).catch(() => ({ state: 'missing' }));
      info.progress = j.progress || 0; info.msg = j.msg;
      if (j.state === 'done' || j.state === 'error' || j.state === 'missing') {
        delete JOBS[jid];
        if (j.state === 'error') toast(`${info.label}: ${j.msg}`, true);
        await refreshMedia();
        if (j.state === 'done' && info.onDone) info.onDone(j.result);
        if (j.state === 'done' && info.kind === 'import' && info.as) { const m = L.mediaById[info.mediaId]; if (m) addAudioItem(m, info.as, info.at); }
      }
    }
    if (!Object.keys(JOBS).length && P && P.media.some(m => !m.ready)) await refreshMedia();
    if (tab === 'media' || tab === 'ai') renderLeft(); else renderJobs();
    if (!Object.keys(JOBS).length && P && !P.media.some(m => !m.ready)) break;
    await new Promise(r => setTimeout(r, 900));
  }
  polling = false;
}
async function refreshMedia() {
  const s = await api(`/api/projects/${P.id}`); const byId = Object.fromEntries(s.media.map(m => [m.id, m]));
  P.media = P.media.map(m => byId[m.id] ? { ...m, ...byId[m.id] } : m);
  for (const m of s.media) if (!P.media.find(x => x.id === m.id)) P.media.push(m);
  L = RC.layout(P); stage.setProject(P); renderTL(); drawNow();
}
function renderJobs() {
  const el = $('jobList'); const list = Object.values(JOBS).filter(j => j.kind !== 'import');
  if (el) el.innerHTML = list.map(j => `<div class="job"><span>${esc(j.label)}</span><div class="bar"><i style="width:${j.progress}%"></i></div><span>${Math.round(j.progress)}%</span></div><div class="hint">${esc(j.msg || '')}</div>`).join('');
}

/* ═════════ STOCK (Pixabay official API / Pixabay site / Freesound CC0) ═════════ */
async function stockSearch() {
  stockQ = $('stockQ').value.trim();
  if (stockKind === 'music' || stockKind === 'sfx') { if (stockKind === 'music' || !stockQ) return openPixabaySite(); stockRes = await api(`/api/freesound?q=${encodeURIComponent(stockQ)}`).catch(e => ({ error: e.message })); }
  else stockRes = await api(`/api/pixabay?type=${stockKind}&q=${encodeURIComponent(stockQ)}`).catch(e => ({ error: e.message }));
  renderLeft();
}
function openPixabaySite() {
  const q = encodeURIComponent((($('stockQ') || {}).value || stockQ || '').trim());
  window.open(`https://pixabay.com/${stockKind === 'sfx' ? 'sound-effects' : 'music'}/${q ? 'search/' + q + '/' : ''}`, '_blank');
  setTimeout(loadRecent, 15000);
}
async function loadRecent() { recentDl = await api('/api/recent-downloads').catch(() => []); if (tab === 'stock') renderLeft(); }
let previewAudio = null;
function previewUrl(u) { if (previewAudio) previewAudio.pause(); previewAudio = new Audio(u); previewAudio.play().catch(() => {}); }
async function importUrl(url, name, as) {
  try { const r = await api(`/api/projects/${P.id}/import-url`, { method: 'POST', body: JSON.stringify({ url, name }) }); P.media.push(r.media); JOBS[r.job] = { kind: 'import', mediaId: r.media.id, label: name, progress: 0, as, at: T }; pollJobs(); toast('กำลังนำเข้า ' + name); }
  catch (e) { toast(e.message, true); }
}
async function importDownload(name) {
  const as = stockKind === 'sfx' ? 'sfx' : /\.(mp3|wav|m4a|ogg)$/i.test(name) ? 'music' : undefined;
  try { const r = await api(`/api/projects/${P.id}/import-download`, { method: 'POST', body: JSON.stringify({ name }) }); P.media.push(r.media); JOBS[r.job] = { kind: 'import', mediaId: r.media.id, label: name, progress: 0, as: as === 'sfx' ? 'voice' : as, at: T }; pollJobs(); toast('กำลังนำเข้า ' + name); }
  catch (e) { toast(e.message, true); }
}
async function settingsDialog() {
  const s = await api('/api/settings');
  const m = modal(`<h3>⚙ ตั้งค่า</h3>
    <div><span class="lbl">Pixabay API key (ฟรี — สมัครที่ pixabay.com/api/docs)</span><input class="inp" id="stPx" value="${esc(s.pixabayKey || '')}" placeholder="วาง API key"></div>
    <div><span class="lbl">Freesound API key (ฟรี — freesound.org/apiv2/apply)</span><input class="inp" id="stFs" value="${esc(s.freesoundKey || '')}" placeholder="วาง API key"></div>
    <div><span class="lbl">คำเฉพาะที่ใช้บ่อย (ช่วย AI ถอดเสียงให้ถูก)</span><input class="inp" id="stGl" value="${esc(s.glossary || 'รัตนไพบูลย์, รัตนมาร์ท, ธงฟ้าประชารัฐ, นครปฐม')}"></div>
    <div class="hint">โมเดลถอดเสียงภาษาไทย: ${s.thModel ? '✅ Thonburian Whisper (ปรับจูนภาษาไทย)' : '⏳ ใช้ Whisper มาตรฐานไปก่อน'}</div>
    <div class="row" style="justify-content:flex-end"><button class="pill sm ol" onclick="this.closest('.modal-bg').remove()">ยกเลิก</button><button class="pill sm wh" id="stSave">บันทึก</button></div>`);
  m.querySelector('#stSave').onclick = async () => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ pixabayKey: m.querySelector('#stPx').value.trim(), freesoundKey: m.querySelector('#stFs').value.trim(), glossary: m.querySelector('#stGl').value.trim() }) }); m.remove(); toast('บันทึกการตั้งค่าแล้ว'); };
}

/* ═════════ ADD THINGS ═════════ */
function addMedia(mid, as) {
  const m = L.mediaById[mid]; if (!m || !m.ready) return toast('รอให้ไฟล์เตรียมเสร็จก่อน', true);
  if (m.type === 'audio' || as === 'audio') return addAudioItem(m, m.type === 'audio' ? 'music' : 'voice', as === 'audio' ? T : 0);
  P.main.push({ id: uid('c'), mediaId: mid, in: 0, out: m.type === 'image' ? 5 : m.dur, trans: { type: 'none', dur: .5 }, filter: {}, zooms: [], vol: 1 });
  changed(); afterStruct(); toast('เพิ่มลงแทร็กหลักแล้ว');
}
function addAudioItem(m, kind, at = T) {
  const lane = freeLane(P.audio, at, at + m.dur);
  P.audio.push({ id: uid('a'), kind: kind || 'music', mediaId: m.id, lane, s: at, in: 0, out: m.dur, vol: kind === 'music' ? .35 : 1, speed: 1, duck: true });
  changed(); afterStruct(); select('audio', P.audio[P.audio.length - 1].id);
}
function freeLane(arr, s, e) { for (let l = 0; l < 50; l++) if (!arr.some(x => (x.lane || 0) === l && x.s < e && (x.e ?? x.s + RC.itemDur(x)) > s)) return l; return 0; }
function addItem(o) { const s = T, e = Math.max(T + .5, o.e ?? T + 3); const x = { id: uid('i'), s, e, x: .5, y: .5, sc: 1, rot: 0, op: 1, kf: [], ...o }; x.e = e; x.lane = freeLane(P.items, x.s, x.e); P.items.push(x); changed(); afterStruct(); select('item', x.id); return x; }
function addText(preset = 'pop') { const s = RC.TEXT_PRESETS[preset]; addItem({ kind: 'text', text: 'พิมพ์ข้อความ', ...s, name: undefined, size: 96, anim: 'pop', y: .3 }); }
function applyPreset(k) { const x = sel && sel.t === 'item' ? findSel() : null; const s = { ...RC.TEXT_PRESETS[k] }; delete s.name;
  if (x && x.kind === 'text') { ['color', 'stroke', 'strokeW', 'shadow', 'glow', 'bg', 'border', 'radius', 'tail', 'grad', 'tilt', 'font', 'weight', 'hl'].forEach(p => delete x[p]); Object.assign(x, s); changed(); afterStruct(); }
  else addText(k); }
function setTextAnim(a) { const x = findSel(); if (!x || x.kind !== 'text') return toast('เลือกข้อความก่อน', true); x.anim = a; changed(); afterStruct(); }
function addSticker(e) { addItem({ kind: 'sticker', emoji: e, size: 200, x: .78, y: .22, anim: 'pop' }); }
function addOverlay(mid) { const m = L.mediaById[mid]; addItem({ kind: 'media', mediaId: mid, in: 0, e: T + Math.min(m.dur || 5, 8), w: .45, x: .72, y: .3, radius: 24, border: 6, borderColor: '#ffffff', vol: 0 }); }
function addSfx(file) { P.audio.push({ id: uid('a'), kind: 'sfx', file, s: T, vol: .7, lane: freeLane(P.audio, T, T + 1.5), len: 1.5 }); changed(); afterStruct(); playSfx({ file, vol: .7 }); }
function previewSfx(file) { playSfx({ file, vol: .8 }); }

/* filters / transitions / zooms */
function setGroup(group, key, v) {
  const x = findSel(); if (!x) return;
  if (group === 'chroma') { x.chroma ||= {}; x.chroma[key] = v; stage.dirty = true; }
  else if (group === 'filter') { x.filter ||= {}; x.filter[key] = v; }
  else if (group === 'trans') { x.trans ||= { type: 'fade' }; x.trans[key] = v; L = RC.layout(P); stage.setProject(P); renderTL(); }
  else if (group === 'props') { x[key] = v; if (['size', 'strokeW', 'radius', 'spacing', 'w', 'border'].includes(key)) stage.dirty = true; }
  else if (group === 'kfp') setProp(x, { [key]: v });
  changed(true); drawNow();
}
function chroma(k, v) { setGroup('chroma', k, v); stage.dirty = true; drawNow(); }
function setFilter(k, v) { const c = findSel(); if (!c) return; if (k === 'reset') c.filter = {}; else { c.filter ||= {}; c.filter[k] = v; } changed(); renderLeft(); drawNow(); }
function setTrans(k) { const c = sel && sel.t === 'main' ? findSel() : null; if (!c) return toast('เลือกคลิปบนแทร็กหลักก่อน', true); if (P.main.indexOf(c) === 0 && k !== 'none') toast('ทรานซิชันจะเห็นผลเมื่อมีคลิปก่อนหน้า'); c.trans = { type: k, dur: c.trans?.dur || .5 }; changed(); afterStruct(); renderLeft(); }
function setTransAll() { const c = findSel(); P.main.forEach((x, i) => { if (i) x.trans = { ...c.trans }; }); changed(); afterStruct(); toast('ใช้ทรานซิชันกับทุกรอยต่อแล้ว'); }
function addZoom() { const c = findSel(); const cl = L.clips.find(x => x.c === c); if (!cl || T < cl.start || T > cl.end) return toast('เลื่อนหัวอ่านให้อยู่ในคลิปที่เลือก', true); c.zooms ||= []; c.zooms.push({ t: T - cl.start, d: 1.5, s: 1.2 }); changed(); renderLeft(); drawNow(); }
function clearZooms() { findSel().zooms = []; changed(); renderLeft(); drawNow(); }

/* ═════════ DRAWING ═════════ */
let drawing = false, drawTool = 'arrow', drawColor = '#FF3B30', drawW = 12, curDraw = null;
function toggleDraw() {
  drawing = !drawing; $('drawLayer').style.display = drawing ? 'block' : 'none';
  if (drawing) { pause(); curDraw = addItem({ kind: 'draw', strokes: [], color: drawColor }); } else { if (curDraw && !curDraw.strokes.length) { P.items = P.items.filter(x => x !== curDraw); afterStruct(); } curDraw = null; }
  renderLeft();
}
$('drawLayer').addEventListener('pointerdown', e => {
  if (!curDraw) return; const cv = $('drawLayer'), r = cv.getBoundingClientRect(), g = cv.getContext('2d');
  const pt = ev => [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  const st = { tool: drawTool, color: drawColor, w: drawW, pts: [pt(e)] };
  const mv = ev => { st.pts.push(pt(ev)); g.clearRect(0, 0, cv.width, cv.height); g.strokeStyle = drawColor; g.lineWidth = drawW * SCALE * (drawTool === 'hl' ? 3 : 1); g.globalAlpha = drawTool === 'hl' ? .4 : 1; g.lineCap = 'round'; g.beginPath(); const ps = drawTool === 'line' || drawTool === 'arrow' ? [st.pts[0], st.pts[st.pts.length - 1]] : st.pts; ps.forEach(([a, b], i) => i ? g.lineTo(a * cv.width, b * cv.height) : g.moveTo(a * cv.width, b * cv.height)); g.stroke(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); g.clearRect(0, 0, cv.width, cv.height); if (st.pts.length > 1) { curDraw.strokes.push(st); stage.dirty = true; changed(); drawNow(); } };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});

/* ═════════ VOICE RECORDING ═════════ */
let rec = null;
async function toggleRec() {
  if (rec) { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = [], at = T;
    rec = new MediaRecorder(stream); rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); rec = null; renderLeft(); const f = new File(chunks, `voice-${Date.now()}.webm`, { type: 'audio/webm' }); await importFiles([f], 'voice'); const j = Object.values(JOBS).find(j => j.label === f.name); if (j) j.at = at; };
    rec.start(); renderLeft(); if (!playing) play();
  } catch (e) { toast('เปิดไมค์ไม่ได้: ' + e.message, true); }
}

/* ═════════ AI ═════════ */
function autoCaptions() {
  const clips = L.clips.filter(cl => cl.m && cl.m.hasAudio); if (!clips.length) return toast('ยังไม่มีคลิปที่มีเสียงบนแทร็กหลัก', true);
  const style = $('capStyle').value, chars = +$('capChars').value || 14, demucs = $('capDemucs').checked, hl = $('capHl').checked;
  const glossary = $('capGloss').value; P.settings.glossary = glossary;
  const need = [...new Set(clips.filter(cl => !cl.m.words || $('capRedo').checked).map(cl => cl.m.id))];
  const finish = () => { makeCaptions(style, chars, hl); toast('สร้างซับเรียบร้อย ✓ แก้คำผิดได้ที่แผงขวา'); };
  if (!need.length) return finish();
  let left = need.length;
  need.forEach(async mid => {
    const r = await api(`/api/projects/${P.id}/transcribe`, { method: 'POST', body: JSON.stringify({ mediaId: mid, demucs, glossary }) });
    JOBS[r.job] = { kind: 'transcribe', label: '✨ ถอดเสียง: ' + (L.mediaById[mid].name || ''), progress: 0, onDone: () => { if (--left === 0) finish(); } };
    pollJobs();
  });
  toast('AI เริ่มถอดเสียงแล้ว ดูความคืบหน้าในแท็บ AI');
}
const HL_RE = /[0-9๐-๙]|บาท|ลด|ฟรี|%|โปร/;
/* Whisper splits Thai into character fragments. Re-cut into real Thai words (Intl.Segmenter) and give each word
   the time of its first/last character, interpolated inside the fragment it came from. */
const WSEG = Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
function thaiWords(pieces) {
  if (!WSEG || !pieces.length) return pieces;
  const chars = [];   // {c, t, gapBefore}
  pieces.forEach((p, i) => { const s = p.w.trim().replace(/ํา/g, 'ำ'), n = s.length || 1; [...s].forEach((c, k) => chars.push({ c, t: p.s + (p.e - p.s) * k / n, te: p.s + (p.e - p.s) * (k + 1) / n, gap: k === 0 && i > 0 ? p.s - pieces[i - 1].e : 0, sp: k === 0 && /^\s/.test(p.w) })); });
  for (let i = chars.length - 2; i >= 0; i--) if (chars[i].c === 'ํ' && chars[i + 1].c === 'า') { chars[i].c = 'ำ'; chars[i].te = chars[i + 1].te; chars.splice(i + 1, 1); }
  // phrase = run of characters without a long pause; segment each phrase separately
  const out = []; let start = 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i < chars.length && chars[i].gap < .35) continue;
    const ph = chars.slice(start, i), txt = ph.map(x => x.c).join('');
    let off = 0;
    for (const g of segWords(txt)) {
      const a = ph[off], b = ph[off + g.length - 1]; off += g.length;
      if (!g.trim() || !a || !b) continue;
      out.push({ w: g, s: +a.t.toFixed(2), e: +b.te.toFixed(2), gap: a.gap });
    }
    start = i;
  }
  return out;
}
function makeCaptions(style, chars, hl) {
  P.items = P.items.filter(x => !x.auto);
  const preset = { ...RC.TEXT_PRESETS[style] }; delete preset.name;
  const lane = Math.max(-1, ...P.items.map(x => x.lane || 0)) + 1;
  for (const cl of L.clips) {
    const ws = thaiWords((cl.m && cl.m.words || []).filter(w => w.s >= (cl.c.in || 0) - .05 && w.e <= (cl.c.out || 0) + .05 && w.w.trim()));
    const sp = cl.c.speed || 1, map = t => cl.start + (t - (cl.c.in || 0)) / sp;
    const phrases = []; let ph = [];
    ws.forEach((w, i) => { if (i && (w.s - ws[i - 1].e > .6 || /[.?!]$/.test(ws[i - 1].w))) { phrases.push(ph); ph = []; } ph.push(w); }); if (ph.length) phrases.push(ph);
    for (const p of phrases) {
      const words = p.map(w => ({ t: w.w.trim(), s: +map(w.s).toFixed(2), e: +map(w.e).toFixed(2), hl: hl && HL_RE.test(w.w) }));
      for (const cur of chunkWords(words, chars)) P.items.push({ id: uid('i'), kind: 'text', auto: true, lane, s: cur[0].s, e: Math.min(cl.end, cur[cur.length - 1].e + .25), x: .5, y: .74, sc: 1, rot: 0, op: 1, kf: [], size: 74, anim: 'karaoke', ...preset, words: cur, text: cur.map(w => w.t).join('') });
    }
  }
  for (const a of P.items.filter(x => x.auto)) { const nx = P.items.find(b => b.auto && b.s > a.s && b.s < a.e); if (nx) a.e = nx.s; }
  changed(); afterStruct(); renderLeft();
}
const GLOSS = 'รัตนไพบูลย์, รัตนมาร์ท, ธงฟ้าประชารัฐ, นครปฐม';
/* Thai word split that never breaks a glossary term (brand / place names) */
function segWords(text) {
  const terms = String(P.settings.glossary ?? (window.GLOSS_DEF || GLOSS)).split(/[,\n]/).map(s => s.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const out = []; let rest = text;
  while (rest) {
    let best = -1, term = '';
    for (const g of terms) { const i = rest.indexOf(g); if (i >= 0 && (best < 0 || i < best)) { best = i; term = g; } }
    const head = best < 0 ? rest : rest.slice(0, best);
    if (head) for (const s of (WSEG ? [...WSEG.segment(head)].map(x => x.segment) : head.split(/(\s+)/))) out.push(s);
    if (best < 0) break; out.push(term); rest = rest.slice(best + term.length);
  }
  return out;
}
/* split a run of words into captions of ≤ 2 balanced lines, each line ≤ chars (no orphan words) */
function chunkWords(words, chars) {
  const L1 = w => w.t.length, tot = words.reduce((a, w) => a + L1(w), 0);
  const n = Math.max(1, Math.ceil(tot / (chars * 2))), target = tot / n, groups = [];
  let cur = [], len = 0;
  for (const w of words) { if (cur.length && len + L1(w) / 2 > target && groups.length < n - 1) { groups.push(cur); cur = []; len = 0; } cur.push({ ...w, br: false }); len += L1(w); }
  if (cur.length) groups.push(cur);
  for (const g of groups) {
    const gl = g.reduce((a, w) => a + L1(w), 0); if (gl <= chars) continue;
    let acc = 0, bi = 1, bd = 1e9;   // best balanced break point
    for (let i = 1; i < g.length; i++) { acc += L1(g[i - 1]); const d = Math.abs(acc - (gl - acc)); if (d < bd) { bd = d; bi = i; } }
    g[bi].br = true;
  }
  return groups;
}
api('/api/settings').then(s => { if (s.glossary) window.GLOSS_DEF = s.glossary; }).catch(() => {});
/* edit one caption: keep its time span, spread the new words over it */
function editCap(id, v) {
  const x = P.items.find(i => i.id === id); if (!x) return;
  const s = x.words ? x.words[0].s : x.s, e = x.words ? x.words[x.words.length - 1].e : x.e;
  x.words = spreadWords(v.replace(/\s*\/\s*/g, '\n'), s, e); x.text = x.words.map(w => w.t).join('');
  stage.dirty = true; changed(); drawNow(); renderTL();
}
function spreadWords(txt, s, e) {
  const out = []; txt.split('\n').forEach((ln, li) => { const segs = WSEG ? [...WSEG.segment(ln)].map(x => x.segment) : ln.split(/(\s+)/); segs.forEach((g, gi) => { if (g.trim()) out.push({ t: g, br: li > 0 && !out.some(o => o.li === li), li }); }); });
  const tot = out.reduce((a, w) => a + w.t.length, 0) || 1; let t = s;
  return out.map(w => { const d = (e - s) * w.t.length / tot, r = { t: w.t, s: +t.toFixed(2), e: +(t + d).toFixed(2), br: w.br, hl: HL_RE.test(w.t) }; t += d; return r; });
}
/* align a correct script to the speech: character-level LCS between the script and Whisper's timed characters,
   then interpolate a time for every script character from the matched anchors */
function alignScript() {
  const script = $('capScript').value.trim(); if (!script) return toast('วางสคริปต์ก่อน', true);
  P.settings.script = script;
  const timed = [];   // whisper characters on the timeline
  for (const cl of L.clips) {
    const ws = (cl.m && cl.m.words || []).filter(w => w.s >= (cl.c.in || 0) - .05 && w.e <= (cl.c.out || 0) + .05), sp = cl.c.speed || 1;
    for (const w of ws) { const s = w.w.replace(/\s/g, '').replace(/ํา/g, 'ำ'), n = s.length; [...s].forEach((c, k) => timed.push({ c, t: cl.start + (w.s + (w.e - w.s) * k / n - (cl.c.in || 0)) / sp })); }
  }
  if (!timed.length) return toast('ต้องถอดเสียงก่อน 1 ครั้ง (กด "สร้างซับอัตโนมัติ") เพื่อรู้จังหวะเสียง', true);
  const sc = []; script.split('\n').forEach((ln, li) => [...ln].forEach(c => sc.push({ c, li })));
  const A = sc.filter(x => x.c.trim()), B = timed, n = A.length, m = B.length;
  if (n * m > 6e6) return toast('สคริปต์ยาวเกินไป แบ่งเป็นช่วงๆ', true);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i].c === B[j].c ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const anchor = new Array(n).fill(null);
  for (let i = 0, j = 0; i < n && j < m;) { if (A[i].c === B[j].c) { anchor[i] = B[j].t; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  const known = anchor.map((t, i) => t == null ? null : i).filter(i => i != null);
  if (known.length < n * .2) toast('สคริปต์ตรงกับเสียงน้อย เวลาอาจคลาดเคลื่อน', true);
  A.forEach((a, i) => { if (anchor[i] != null) { a.t = anchor[i]; return; } const p = known.filter(k => k < i).pop(), q = known.find(k => k > i);
    a.t = p == null ? (q == null ? 0 : anchor[q]) : q == null ? anchor[p] + (i - p) * .12 : anchor[p] + (anchor[q] - anchor[p]) * (i - p) / (q - p); });
  // build captions: one per script line (long lines wrap into 2 lines / split by chars)
  const style = $('capStyle').value, chars = +$('capChars').value || 14, hl = $('capHl').checked, preset = { ...RC.TEXT_PRESETS[style] }; delete preset.name;
  P.items = P.items.filter(x => !x.auto); const lane = Math.max(-1, ...P.items.map(x => x.lane || 0)) + 1;
  let k = 0;
  script.split('\n').forEach((ln, li) => {
    const lineChars = A.filter(a => a.li === li); if (!lineChars.length) return;
    const words = []; let off = 0, ci = A.indexOf(lineChars[0]);
    for (const g of segWords(ln)) {
      const nn = g.replace(/\s/g, '').length; if (!nn) continue;
      const a = A[ci], b = A[ci + nn - 1]; ci += nn; words.push({ t: g, s: +a.t.toFixed(2), e: +(b.t + .12).toFixed(2), hl: hl && HL_RE.test(g) });
    }
    for (const cur of chunkWords(words, chars)) P.items.push({ id: uid('i'), kind: 'text', auto: true, lane, s: cur[0].s, e: cur[cur.length - 1].e + .25, x: .5, y: .74, sc: 1, rot: 0, op: 1, kf: [], size: 74, anim: 'karaoke', ...preset, words: cur, text: cur.map(w => w.t).join('') });
    k++;
  });
  for (const a of P.items.filter(x => x.auto)) { const nx = P.items.filter(b => b.auto && b.s > a.s).sort((x, y) => x.s - y.s)[0]; if (nx && nx.s < a.e) a.e = nx.s; }
  changed(); afterStruct(); renderLeft(); toast(`จัดเวลาสคริปต์แล้ว ${k} บรรทัด ✓`);
}
function cutSilence() {
  const c = findSel(); const m = L.mediaById[c.mediaId]; if (!m.words) return toast('ต้องถอดเสียงคลิปนี้ก่อน (กด "สร้างซับอัตโนมัติ" หรือรอให้เสร็จ)', true);
  const PAD = .12, ws = m.words.filter(w => w.s >= c.in && w.e <= c.out), keep = [];
  for (const w of ws) { const s = Math.max(c.in, w.s - PAD), e = Math.min(c.out, w.e + PAD); if (keep.length && s - keep[keep.length - 1][1] < silGap) keep[keep.length - 1][1] = Math.max(keep[keep.length - 1][1], e); else keep.push([s, e]); }
  if (keep.length < 2 && keep[0] && keep[0][0] - c.in < silGap && c.out - keep[0][1] < silGap) return toast('ไม่พบช่วงเงียบที่ยาวพอ');
  const i = P.main.indexOf(c), punch = $('silPunch').checked, removed = (c.out - c.in) - keep.reduce((a, [s, e]) => a + e - s, 0);
  const parts = keep.map(([s, e], k) => ({ ...JSON.parse(JSON.stringify(c)), id: uid('c'), in: s, out: e, trans: k ? { type: 'none', dur: .5 } : c.trans, punch: punch && k % 2 === 1, zooms: [] }));
  P.main.splice(i, 1, ...parts); changed(); afterStruct(); select('main', parts[0].id); toast(`ตัดช่วงเงียบออก ${removed.toFixed(1)} วินาที (${parts.length} ช่วง)`);
}
function autoZoomKeywords() {
  let n = 0;
  for (const x of P.items.filter(x => x.auto && x.words)) for (const w of x.words.filter(w => w.hl)) {
    const cl = L.clips.find(cl => w.s >= cl.start && w.s < cl.end); if (!cl) continue;
    cl.c.zooms ||= []; const t = w.s - cl.start; if (cl.c.zooms.some(z => Math.abs(z.t - t) < 1.5)) continue;
    cl.c.zooms.push({ t, d: Math.max(.8, w.e - w.s + .5), s: 1.18 }); n++;
  }
  changed(); drawNow(); toast(n ? `ใส่ซูม ${n} จุด` : 'ยังไม่มีคำที่ไฮไลต์ในซับ', !n);
}

/* ═════════ INSPECTOR ═════════ */
function renderInsp() {
  const x = findSel(), el = $('insp');
  if (!x) { el.innerHTML = `<div class="hint" style="margin-top:20px;text-align:center">เลือกชิ้นงานบนไทม์ไลน์<br>หรือคลิกข้อความบนจอ<br><br>⌨️ Space เล่น · S ตัดแบ่ง · Delete ลบ<br>Ctrl+Z ย้อนกลับ · Ctrl+D คัดลอก · K คีย์เฟรม</div>`; $('selInfo').textContent = ''; return; }
  let h = '';
  if (sel.t === 'main') {
    const m = L.mediaById[x.mediaId] || {};
    h = `<h4>🎬 คลิป: ${esc(m.name || '')}</h4>
      ${num('เริ่ม (วิ)', 'in', x.in)}${num('จบ (วิ)', 'out', x.out)}
      ${rng('ระดับเสียง', 'props', 'vol', x.vol ?? 1, 0, 2, .01)}${rng('ความเร็ว', 'props', 'speed', x.speed ?? 1, .25, 4, .05)}
      <div><span class="lbl">การจัดภาพ</span><div class="row"><button class="chip${x.fit !== 'contain' ? ' on' : ''}" onclick="setX('fit','cover')">เต็มจอ</button><button class="chip${x.fit === 'contain' ? ' on' : ''}" onclick="setX('fit','contain')">พอดีกรอบ</button></div></div>
      <div class="hint">ฟิลเตอร์/ซูม → แท็บเอฟเฟกต์ · ทรานซิชัน → แท็บทรานซิชัน</div>`;
  } else if (sel.t === 'item') {
    const k = RC.kfAt(x, T - x.s);
    h = `<h4>${{ text: '🅰 ข้อความ', sticker: '😀 สติกเกอร์', media: '🖼 ภาพซ้อน', draw: '✏️ วาดรูป' }[x.kind]}</h4>`;
    if (x.kind === 'text') {
      h += `<textarea class="inp" oninput="setText(this.value)">${esc(x.anim === 'karaoke' && x.words ? x.words.map(w => (w.br ? '\n' : '') + w.t).join('') : x.text)}</textarea>
        <div class="grid2"><div><span class="lbl">ฟอนต์</span><select class="inp" onchange="setX('font',this.value,1)">${RC.FONTS.map(f => `<option${x.font === f ? ' selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></div>
        <div><span class="lbl">แอนิเมชัน</span><select class="inp" onchange="setX('anim',this.value,1)">${Object.entries(RC.TEXT_ANIMS).map(([a, n]) => `<option value="${a}"${x.anim === a ? ' selected' : ''}>${n}</option>`).join('')}</select></div></div>
        ${rng('ขนาด', 'props', 'size', x.size || 80, 20, 260, 1)}${rng('ระยะตัวอักษร', 'props', 'spacing', x.spacing || 0, -.05, .4, .01)}
        <div class="row" style="flex-wrap:wrap;gap:10px">
          ${col('สีตัวอักษร', 'color', x.color || '#ffffff')}${col('สีไฮไลต์', 'hl', x.hl || '#FFE14D')}${col('สีขอบ', 'stroke', x.stroke || '#000000')}${col('พื้นหลัง', 'bg', x.bg || '#000000')}${col('เรืองแสง', 'glow', x.glow || '#2F9BFF')}</div>
        ${rng('ความหนาขอบ', 'props', 'strokeW', x.strokeW || 0, 0, .3, .01)}
        <div class="row" style="flex-wrap:wrap"><label class="chip"><input type="checkbox" ${x.shadow ? 'checked' : ''} onchange="setX('shadow',this.checked,1)">&nbsp;เงา</label>
          <label class="chip"><input type="checkbox" ${x.bg ? 'checked' : ''} onchange="setX('bg',this.checked?'#000000':null,1)">&nbsp;พื้นหลัง</label>
          <label class="chip"><input type="checkbox" ${x.glow ? 'checked' : ''} onchange="setX('glow',this.checked?'#2F9BFF':null,1)">&nbsp;เรืองแสง</label>
          <label class="chip"><input type="checkbox" ${x.grad ? 'checked' : ''} onchange="setX('grad',this.checked?['#FFF37A','#FF7A1A']:null,1)">&nbsp;ไล่สี</label></div>`;
    } else if (x.kind === 'sticker') {
      h += `${rng('ขนาด', 'props', 'size', x.size || 180, 40, 600, 1)}<div><span class="lbl">การเคลื่อนไหว</span><div class="row">${[['pop', 'เด้ง'], ['pulse', 'เต้น'], ['wobble', 'ส่าย'], ['spin', 'หมุน']].map(([a, n]) => `<button class="chip${x.anim === a ? ' on' : ''}" onclick="setX('anim','${a}',1)">${n}</button>`).join('')}</div></div>`;
    } else if (x.kind === 'media') {
      h += `${rng('ความกว้าง', 'props', 'w', x.w || .45, .1, 1, .01)}${rng('ขอบมน', 'props', 'radius', x.radius || 0, 0, 200, 1)}${rng('กรอบ', 'props', 'border', x.border || 0, 0, 30, 1)}${rng('เสียง', 'props', 'vol', x.vol || 0, 0, 1.5, .01)}<div class="hint">ลบฉากเขียว → แท็บเอฟเฟกต์</div>`;
    } else if (x.kind === 'draw') h += `<div class="hint">${x.strokes.length} เส้น · เส้นจะค่อยๆ วาดออกมาใน 0.6 วินาทีแรก</div>`;
    if (x.kind !== 'draw') h += `<div class="card"><h4>ตำแหน่ง ${x.kf && x.kf.length ? '<span class="hint">(แก้ที่คีย์เฟรมปัจจุบัน)</span>' : ''}</h4>
        ${rng('แนวนอน', 'kfp', 'x', k.x, -.2, 1.2, .005)}${rng('แนวตั้ง', 'kfp', 'y', k.y, -.2, 1.2, .005)}${rng('ขนาด', 'kfp', 'sc', k.sc, .1, 5, .01)}${rng('หมุน', 'kfp', 'rot', k.rot, -180, 180, 1)}${rng('ความทึบ', 'kfp', 'op', k.op, 0, 1, .01)}
        <div class="row"><button class="pill sm ol" onclick="addKf()">◆ คีย์เฟรมที่หัวอ่าน</button></div>
        <div class="kfl">${(x.kf || []).sort((a, b) => a.t - b.t).map((kk, i) => `<span>◆ ${kk.t.toFixed(2)}s<button onclick="delKf(${i})">✕</button></span>`).join('')}</div></div>`;
    h += `${num('เริ่ม (วิ)', 's', x.s)}${num('จบ (วิ)', 'e', x.e)}`;
  } else {
    const m = L.mediaById[x.mediaId] || {};
    h = `<h4>${{ music: '🎵 เพลง', voice: '🎙 เสียงพากย์', sfx: '🔊 เอฟเฟกต์เสียง' }[x.kind]}</h4><div class="hint">${esc(x.kind === 'sfx' ? x.file : m.name)}</div>
      ${x.kind !== 'sfx' ? `<div><span class="lbl">ชนิด</span><div class="row"><button class="chip${x.kind === 'music' ? ' on' : ''}" onclick="setX('kind','music',1)">เพลง</button><button class="chip${x.kind === 'voice' ? ' on' : ''}" onclick="setX('kind','voice',1)">เสียงพากย์</button></div></div>` : ''}
      ${rng('ระดับเสียง', 'props', 'vol', x.vol ?? 1, 0, 2, .01)}${x.kind !== 'sfx' ? rng('ความเร็ว', 'props', 'speed', x.speed ?? 1, .25, 4, .05) : ''}
      ${x.kind === 'music' ? `<label class="row hint"><input type="checkbox" ${x.duck !== false ? 'checked' : ''} onchange="setX('duck',this.checked)"> หรี่เพลงตอนมีคนพูด</label>` : ''}
      ${num('เริ่ม (วิ)', 's', x.s)}`;
  }
  h += `<div class="row" style="margin-top:6px"><button class="pill sm ol" onclick="dupSel()">⧉ คัดลอก</button><button class="pill sm ol" style="color:#fca5a5" onclick="delSel()">🗑 ลบ</button></div>`;
  el.innerHTML = h;
}
const num = (label, key, v) => `<div class="kv"><span>${label}</span><input class="inp" type="number" step="0.05" value="${(+v).toFixed(2)}" style="height:30px" onchange="setX('${key}',+this.value,1)"><span></span></div>`;
const col = (label, key, v) => `<label class="hint" style="display:flex;flex-direction:column;gap:4px;align-items:center">${label}<input type="color" value="${v}" onchange="setX('${key}',this.value,1)"></label>`;
function setX(k, v, rebuild) { const x = findSel(); if (!x) return; if (v === null) delete x[k]; else x[k] = v;
  if (sel.t === 'main' && (k === 'in' || k === 'out')) { const m = L.mediaById[x.mediaId]; x.in = clamp(x.in, 0, (m.dur || 999) - .1); x.out = clamp(x.out, x.in + .1, m.type === 'image' ? 999 : m.dur); }
  changed(); if (rebuild || k === 's' || k === 'e' || k === 'in' || k === 'out' || k === 'speed') { stage.dirty = true; afterStruct(); } else drawNow(); }
function setText(v) { const x = findSel(); if (x.anim === 'karaoke' && x.words) {
    // keep timing: spread the edited text over the original word span, one "word" per space-separated chunk
    const s = x.words[0].s, e = x.words[x.words.length - 1].e, parts = []; v.split('\n').forEach((ln, li) => ln.split(/(\s+)/).filter(p => p.trim()).forEach((p, pi) => parts.push({ t: p, br: li > 0 && pi === 0 })));
    const tot = parts.reduce((a, p) => a + p.t.length, 0) || 1; let t = s; x.words = parts.map(p => { const d = (e - s) * p.t.length / tot, w = { t: p.t, s: +t.toFixed(2), e: +(t + d).toFixed(2), br: p.br, hl: HL_RE.test(p.t) }; t += d; return w; });
  } x.text = v; stage.dirty = true; changed(true); drawNow(); renderTL(); }
function delKf(i) { const x = findSel(); x.kf.sort((a, b) => a.t - b.t).splice(i, 1); changed(); renderInsp(); renderTL(); drawNow(); }

/* ═════════ TIMELINE ═════════ */
const LANE_H = 40, MAIN_H = 64, PADL = 28;
function renderTL() {
  if (!P) return; L = RC.layout(P);
  const total = Math.max(L.total + 5, 20), W = PADL + total * pps;
  const itLanes = Math.max(0, ...P.items.map(x => x.lane || 0)) + 2, auLanes = Math.max(0, ...P.audio.map(x => x.lane || 0)) + 2;
  let h = `<div class="ruler" id="ruler" style="width:${W}px">`;
  const step = pps > 120 ? .5 : pps > 50 ? 1 : pps > 25 ? 2 : 5;
  for (let s = 0; s <= total; s += step) h += `<i style="left:${PADL + s * pps}px;height:${Math.round(s) === s && s % (step * 2) === 0 ? 10 : 5}px"></i>${s % (step * 2) === 0 ? `<span style="left:${PADL + s * pps}px">${fmt(s).slice(0, 5)}</span>` : ''}`;
  h += '</div>';
  for (let l = itLanes - 1; l >= 0; l--) {
    h += `<div class="lane" data-lane="${l}" data-t="item" style="width:${W}px"><div class="lt">${l === itLanes - 1 ? '＋' : 'T' + (l + 1)}</div>`;
    for (const x of P.items.filter(x => (x.lane || 0) === l)) h += blk('item', x, x.s, x.e - x.s, `k-${x.kind}`, x.kind === 'text' ? (x.text || '').replace(/\n/g, ' ') : x.kind === 'sticker' ? x.emoji : x.kind === 'media' ? '🖼 ' + ((L.mediaById[x.mediaId] || {}).name || '') : '✏️ วาดรูป', x.kf);
    h += '</div>';
  }
  h += `<div class="lane main" data-t="main" style="width:${W}px"><div class="lt">🎬</div>`;
  for (const cl of L.clips) {
    const m = cl.m || {}, bg = m.strip ? `background-image:url('/projects/${P.id}/media/${m.strip}');background-size:${Math.max(56, (m.dur || 1) * pps / (cl.c.speed || 1))}px 100%;background-position:${-(cl.c.in || 0) * pps / (cl.c.speed || 1)}px 0` : '';
    h += `<div class="blk${isSel('main', cl.c.id) ? ' sel' : ''}" data-t="main" data-id="${cl.c.id}" style="left:${PADL + cl.start * pps}px;width:${cl.dur * pps}px;${bg}"><span class="lab">${esc(m.name || '')}${cl.c.speed && cl.c.speed !== 1 ? ' ×' + cl.c.speed : ''}${(cl.c.filter || {}).preset && cl.c.filter.preset !== 'none' ? ' · ' + RC.FILTERS[cl.c.filter.preset].name : ''}</span><div class="h l"></div><div class="h r"></div></div>`;
    if (cl.i > 0) h += `<div class="tr" data-tr="${cl.c.id}" style="left:${PADL + (cl.start + cl.ov / 2) * pps}px;top:20px" title="ทรานซิชัน: ${RC.TRANS[cl.c.trans?.type || 'none']}">${transIcon(cl.c.trans?.type || 'none')}</div>`;
  }
  h += '</div>';
  for (let l = 0; l < auLanes; l++) {
    h += `<div class="lane" data-lane="${l}" data-t="audio" style="width:${W}px"><div class="lt">${l === auLanes - 1 ? '＋' : '♪' + (l + 1)}</div>`;
    for (const x of P.audio.filter(x => (x.lane || 0) === l)) { const d = RC.itemDur(x); h += blk('audio', x, x.s, d, `k-${x.kind}`, x.kind === 'sfx' ? '🔊 ' + x.file.split('/').pop() : (x.kind === 'music' ? '🎵 ' : '🎙 ') + ((L.mediaById[x.mediaId] || {}).name || ''), null, x); }
    h += '</div>';
  }
  h += `<div class="ph" id="ph"></div>`;
  $('tlIn').innerHTML = h; $('tlIn').style.width = W + 'px';
  document.querySelectorAll('.blk canvas[data-wave]').forEach(drawWave);
  updPlayhead(); const x = findSel(); $('selInfo').textContent = x ? `เลือก: ${sel.t === 'main' ? 'คลิป' : sel.t === 'item' ? x.kind : x.kind}` : '';
}
const isSel = (t, id) => sel && sel.t === t && sel.id === id;
function blk(t, x, s, d, cls, label, kf, au) {
  const kfd = (kf || []).map(k => `<span class="kfd" style="left:${k.t * pps}px"></span>`).join('');
  const wave = au && au.kind !== 'sfx' ? `<canvas data-wave="${x.id}"></canvas>` : '';
  return `<div class="blk ${cls}${isSel(t, x.id) ? ' sel' : ''}" data-t="${t}" data-id="${x.id}" style="left:${PADL + s * pps}px;width:${Math.max(6, d * pps)}px">${wave}<span class="lab">${esc(label)}</span>${kfd}<div class="h l"></div><div class="h r"></div></div>`;
}
function drawWave(cv) {
  const x = P.audio.find(a => a.id === cv.dataset.wave), m = x && L.mediaById[x.mediaId]; if (!m || !m.peaks) return;
  const w = cv.width = cv.offsetWidth, h = cv.height = cv.offsetHeight, g = cv.getContext('2d'); g.fillStyle = '#fff';
  const sp = x.speed || 1;
  for (let px = 0; px < w; px += 2) { const t = (x.in || 0) + px / pps * sp, v = m.peaks[Math.floor(t * 50)] || 0; g.fillRect(px, h / 2 - v * h / 2, 1.5, Math.max(1, v * h)); }
}
function updPlayhead() { const ph = $('ph'); if (ph) ph.style.left = PADL + T * pps + 'px'; if (playing) { const sc = $('tlScroll'), x = PADL + T * pps; if (x > sc.scrollLeft + sc.clientWidth - 80) sc.scrollLeft = x - 120; } }
const timeAtX = cx => (cx - $('tlIn').getBoundingClientRect().left - PADL) / pps;
function snapT(t, ignoreId) {
  if (!snapOn) return t; const th = 8 / pps; const pts = [T, 0];
  L.clips.forEach(c => pts.push(c.start, c.end)); P.items.forEach(x => { if (x.id !== ignoreId) pts.push(x.s, x.e); }); P.audio.forEach(x => { if (x.id !== ignoreId) pts.push(x.s, x.s + RC.itemDur(x)); });
  let best = t, bd = th; for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } } return best;
}
$('tlScroll').addEventListener('pointerdown', e => {
  const tr = e.target.closest('.tr');
  if (tr) { select('main', tr.dataset.tr); tab = 'trans'; renderTabs(); renderLeft(); return; }
  if (e.target.closest('#ruler') || !e.target.closest('.blk')) {
    if (!e.target.closest('.blk')) { if (!e.target.closest('#ruler')) select(null); seek(timeAtX(e.clientX)); }
    const mv = ev => seek(timeAtX(ev.clientX)); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    if (e.target.closest('#ruler')) { seek(timeAtX(e.clientX)); addEventListener('pointermove', mv); addEventListener('pointerup', up); }
    return;
  }
  const b = e.target.closest('.blk'), t = b.dataset.t, id = b.dataset.id; select(t, id);
  const x = findSel(), x0 = e.clientX, y0 = e.clientY, edge = e.target.classList.contains('h') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
  const o = JSON.parse(JSON.stringify(x)); let moved = false; e.preventDefault();
  const mv = ev => {
    const dt = (ev.clientX - x0) / pps; if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return; moved = true;
    if (t === 'main') {
      const m = L.mediaById[x.mediaId] || {}, maxOut = m.type === 'image' ? 999 : m.dur, sp = x.speed || 1;
      if (edge === 'l') x.in = clamp(o.in + dt * sp, 0, x.out - .1);
      else if (edge === 'r') x.out = clamp(o.out + dt * sp, x.in + .1, maxOut);
      else { b.style.transform = `translateX(${ev.clientX - x0}px)`; b.style.zIndex = 10; return; }
    } else if (t === 'item') {
      if (edge === 'l') x.s = Math.min(snapT(o.s + dt, x.id), x.e - .1);
      else if (edge === 'r') x.e = Math.max(snapT(o.e + dt, x.id), x.s + .1);
      else { const d = x.e - x.s; x.s = Math.max(0, snapT(o.s + dt, x.id)); x.e = x.s + d; laneDrag(ev, x, 'item'); }
    } else {
      if (edge === 'l' && x.kind !== 'sfx') { const sp = x.speed || 1, nd = clamp(dt, -o.in / sp, (o.out - o.in) / sp - .1); x.s = o.s + nd; x.in = o.in + nd * sp; }
      else if (edge === 'r' && x.kind !== 'sfx') { const m = L.mediaById[x.mediaId]; x.out = clamp(o.out + dt * (x.speed || 1), x.in + .1, m ? m.dur : 999); }
      else { x.s = Math.max(0, snapT(o.s + dt, x.id)); laneDrag(ev, x, 'audio'); }
    }
    stage.setProject(P); renderTL(); drawNow();
  };
  const up = ev => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (!moved) return;
    if (t === 'main' && !edge) {   // reorder on the magnetic track
      const tt = timeAtX(ev.clientX), from = P.main.indexOf(x); let to = L.clips.findIndex(cl => tt < cl.start + cl.dur / 2); if (to < 0) to = P.main.length - 1;
      if (to > from) to--; if (to !== from && to >= 0) { P.main.splice(from, 1); P.main.splice(to, 0, x); }
    }
    changed(); afterStruct();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
function laneDrag(ev, x, kind) {
  const lane = document.elementsFromPoint(ev.clientX, ev.clientY).find(el => el.classList && el.classList.contains('lane') && el.dataset.t === kind);
  if (lane) x.lane = +lane.dataset.lane;
}
/* drop a transition onto a clip */
$('tlScroll').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('trans')) { e.preventDefault(); } });
$('tlScroll').addEventListener('drop', e => {
  const k = e.dataTransfer.getData('trans'); if (!k) return; e.preventDefault();
  const tt = timeAtX(e.clientX); let best = null, bd = 1e9;
  L.clips.forEach(cl => { if (cl.i > 0) { const d = Math.abs(cl.start - tt); if (d < bd) { bd = d; best = cl; } } });
  if (best) { best.c.trans = { type: k, dur: best.c.trans?.dur || .5 }; changed(); afterStruct(); toast('ใส่ทรานซิชัน: ' + RC.TRANS[k]); }
});
$('tlScroll').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); pps = clamp(pps * (e.deltaY < 0 ? 1.12 : .89), 10, 300); $('zoom').value = pps; renderTL(); } }, { passive: false });

/* ═════════ EDIT OPS ═════════ */
function splitAt() {
  const x = findSel();
  if (sel && sel.t === 'main') { const cl = L.clips.find(c => c.c === x); if (!cl || T <= cl.start + .05 || T >= cl.end - .05) return toast('วางหัวอ่านไว้กลางคลิปที่เลือก', true);
    const cut = x.in + (T - cl.start) * (x.speed || 1), b = { ...JSON.parse(JSON.stringify(x)), id: uid('c'), in: cut, trans: { type: 'none', dur: .5 }, zooms: (x.zooms || []).filter(z => z.t > T - cl.start).map(z => ({ ...z, t: z.t - (T - cl.start) })) };
    x.out = cut; x.zooms = (x.zooms || []).filter(z => z.t < T - cl.start); P.main.splice(P.main.indexOf(x) + 1, 0, b); }
  else if (sel && sel.t === 'item') { if (T <= x.s || T >= x.e) return toast('วางหัวอ่านไว้กลางชิ้นงาน', true); const b = { ...JSON.parse(JSON.stringify(x)), id: uid('i'), s: T }; x.e = T; P.items.push(b); }
  else if (sel && sel.t === 'audio' && x.kind !== 'sfx') { const d = RC.itemDur(x); if (T <= x.s || T >= x.s + d) return toast('วางหัวอ่านไว้กลางเสียง', true); const cut = x.in + (T - x.s) * (x.speed || 1), b = { ...x, id: uid('a'), s: T, in: cut }; x.out = cut; P.audio.push(b); }
  else {   // nothing selected: split the main clip under the playhead
    const cl = L.clips.find(c => T > c.start + .05 && T < c.end - .05); if (!cl) return toast('ไม่มีคลิปตรงหัวอ่าน', true); sel = { t: 'main', id: cl.c.id }; return splitAt(); }
  changed(); afterStruct(); toast('ตัดแบ่งแล้ว');
}
function delSel() { if (!sel) return; const arr = sel.t === 'main' ? P.main : sel.t === 'item' ? P.items : P.audio; const i = arr.findIndex(x => x.id === sel.id); if (i < 0) return; arr.splice(i, 1); sel = null; changed(); afterStruct(); }
function dupSel() { const x = findSel(); if (!x) return; const arr = sel.t === 'main' ? P.main : sel.t === 'item' ? P.items : P.audio, c = JSON.parse(JSON.stringify(x)); c.id = uid(sel.t[0]);
  if (sel.t === 'main') arr.splice(arr.indexOf(x) + 1, 0, c); else { const d = sel.t === 'item' ? x.e - x.s : RC.itemDur(x); c.s = sel.t === 'item' ? x.e : x.s + d; if (c.e != null) c.e = c.s + d; arr.push(c); }
  changed(); afterStruct(); select(sel.t, c.id); }

/* ═════════ EXPORT / PACK ═════════ */
function exportDialog() {
  pause(); saveNow();
  const m = modal(`<h3>⬆ ส่งออกวิดีโอ MP4</h3>
    <div><span class="lbl">ความละเอียด</span><div class="row" style="flex-wrap:wrap" id="exRes">${[[480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '2K'], [2160, '4K']].map(([v, n]) => `<button class="chip${v === 1080 ? ' on' : ''}" data-v="${v}">${n}</button>`).join('')}</div></div>
    <div><span class="lbl">เฟรมเรต</span><div class="row" id="exFps">${[24, 30, 60].map(v => `<button class="chip${v === 30 ? ' on' : ''}" data-v="${v}">${v} fps</button>`).join('')}</div></div>
    <div class="hint">ความยาว ${fmt(L.total)} · ${P.ratio} · เสียงปรับความดังมาตรฐาน −14 LUFS<br>ใช้เวลาประมาณ 3–5 เท่าของความยาวคลิปที่ 1080p (4K นานกว่านั้น)</div>
    <div id="exProg" class="hidden"><div class="bigbar"><i id="exBar" style="width:0"></i></div><div class="hint" id="exMsg"></div></div>
    <div class="row" style="justify-content:flex-end" id="exBtns"><button class="pill sm ol" onclick="this.closest('.modal-bg').remove()">ยกเลิก</button><button class="pill sm wh" id="exGo">เริ่มส่งออก</button></div>`);
  ['exRes', 'exFps'].forEach(g => m.querySelectorAll(`#${g} .chip`).forEach(b => b.onclick = () => { m.querySelectorAll(`#${g} .chip`).forEach(x => x.classList.remove('on')); b.classList.add('on'); }));
  m.querySelector('#exGo').onclick = async () => {
    const short = +m.querySelector('#exRes .on').dataset.v, fps = +m.querySelector('#exFps .on').dataset.v;
    m.dataset.lock = 1; m.querySelector('#exProg').classList.remove('hidden'); m.querySelector('#exBtns').innerHTML = '';
    const { job } = await api(`/api/projects/${P.id}/export`, { method: 'POST', body: JSON.stringify({ short, fps }) });
    const tick = async () => { const j = await api(`/api/jobs/${job}`); m.querySelector('#exBar').style.width = (j.progress || 0) + '%'; m.querySelector('#exMsg').textContent = `${j.msg || 'เริ่มต้น'} ${Math.round(j.progress || 0)}%`;
      if (j.state === 'done') { m.dataset.lock = ''; m.querySelector('#exMsg').innerHTML = `✅ เสร็จแล้ว: ${esc(j.result.name)}`; m.querySelector('#exBtns').innerHTML = `<a class="pill sm ol" href="${j.result.file}" download>⬇ ดาวน์โหลด</a><button class="pill sm ol" onclick="api('/api/projects/${P.id}/reveal',{method:'POST',body:JSON.stringify({file:'${j.result.file}'})})">📂 เปิดโฟลเดอร์</button><button class="pill sm wh" onclick="this.closest('.modal-bg').remove()">ปิด</button>`; }
      else if (j.state === 'error') { m.dataset.lock = ''; m.querySelector('#exMsg').textContent = '❌ ' + j.msg; m.querySelector('#exBtns').innerHTML = '<button class="pill sm ol" onclick="this.closest(\'.modal-bg\').remove()">ปิด</button>'; }
      else setTimeout(tick, 1000); };
    tick();
  };
}
async function packProject() {
  await saveNow(); const { job } = await api(`/api/projects/${P.id}/pack`, { method: 'POST' });
  const m = jobModal('กำลังบันทึกเป็นไฟล์ .rcut', job, r => { m.dataset.lock = ''; m.querySelector('.modal').innerHTML += ''; m.querySelector('#jmMsg').innerHTML = `✅ บันทึกแล้ว: <a href="${r.file}" download style="color:#fff">${esc(r.name)}</a> (เปิดในเครื่องอื่นด้วยปุ่ม "เปิดไฟล์ .rcut")`; });
}

/* ═════════ KEYS ═════════ */
addEventListener('keydown', e => {
  if (!P || $('editor').classList.contains('hidden')) return;
  const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 'd') { e.preventDefault(); dupSel(); }
  else if (mod && k === 's') { e.preventDefault(); saveNow(); toast('บันทึกแล้ว'); }
  else if (k === 's') splitAt();
  else if (k === 'k') addKf();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); delSel(); }
  else if (k === 'arrowleft') seek(T - (e.shiftKey ? 1 : 1 / 30));
  else if (k === 'arrowright') seek(T + (e.shiftKey ? 1 : 1 / 30));
  else if (k === 'home') seek(0); else if (k === 'end') seek(L.total);
});
addEventListener('beforeunload', () => { if (P) navigator.sendBeacon && fetch(`/api/projects/${P.id}`, { method: 'PUT', body: JSON.stringify(P), keepalive: true }); });
loadHome();
