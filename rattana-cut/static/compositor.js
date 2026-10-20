/* Rattana Cut v1.0 — compositor shared by the editor preview and the export renderer.
   Project model:
     main[]  : magnetic main track clips {id, mediaId, in, out, trans:{type,dur}, filter:{preset,b,c,s,temp}, zooms:[{t,d,s}], vol, fit, speed}
     items[] : overlay lanes {id, kind:'text'|'sticker'|'media'|'draw', lane, s, e, x, y, sc, rot, op, kf:[{t,x,y,sc,rot,op}], ...}
     audio[] : audio lanes   {id, kind:'music'|'voice'|'sfx', lane, s, mediaId|file, in, out, vol, speed, duck}
   RC.layout(P) -> timing; new RC.Stage(el, P, {mode}) draws time t; RC.buildAudio(ctx, P) mixes offline. */
(function () {
'use strict';
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const prog = (t, a, d) => d <= 0 ? (t >= a ? 1 : 0) : clamp((t - a) / d);
const lerp = (a, b, p) => a + (b - a) * p;
const eOut = x => 1 - Math.pow(1 - x, 3);
const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const eBack = x => { const c1 = 2.0, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const GSEG = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
const graphemes = s => GSEG ? [...GSEG.segment(s)].map(x => x.segment) : [...s];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const RATIOS = { '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5], '4:3': [4, 3], '21:9': [21, 9] };
function frameSize(ratio, short = 1080) { const [a, b] = RATIOS[ratio] || RATIOS['9:16']; return a <= b ? [short, Math.round(short * b / a / 2) * 2] : [Math.round(short * a / b / 2) * 2, short]; }

const FILTERS = {
  none: { name: 'ปกติ', css: '' }, vivid: { name: 'สดใส', css: 'saturate(1.45) contrast(1.08)' },
  warm: { name: 'อบอุ่น', css: 'sepia(.22) saturate(1.25) brightness(1.03)' }, cool: { name: 'เย็นตา', css: 'hue-rotate(-12deg) saturate(1.1) brightness(1.02)' },
  cinema: { name: 'ภาพยนตร์', css: 'contrast(1.18) saturate(.85) brightness(.95) sepia(.08)' }, drama: { name: 'ดราม่า', css: 'contrast(1.38) saturate(1.15) brightness(.88)' },
  vintage: { name: 'วินเทจ', css: 'sepia(.42) contrast(1.05) saturate(.8) brightness(1.02)' }, fade: { name: 'ซีดนุ่ม', css: 'contrast(.86) brightness(1.08) saturate(.8)' },
  pastel: { name: 'พาสเทล', css: 'saturate(.72) brightness(1.1) contrast(.95)' }, bw: { name: 'ขาวดำ', css: 'grayscale(1) contrast(1.12)' },
};
const TRANS = { none: 'ไม่มี', fade: 'จาง', black: 'ดิ่งดำ', white: 'แฟลชขาว', slideL: 'เลื่อนซ้าย', slideR: 'เลื่อนขวา', slideU: 'เลื่อนขึ้น', slideD: 'เลื่อนลง', zoom: 'ซูมเข้า', zoomOut: 'ซูมออก', blur: 'เบลอ', spin: 'หมุน', wipe: 'ปาด', circle: 'วงกลม' };
const TEXT_ANIMS = { none: 'ไม่มี', karaoke: 'ไล่สีทีละคำ', pop: 'เด้งเข้า', bounce: 'เด้งทีละตัว', float: 'ลอยขึ้น', drop: 'หล่นลงมา', type: 'พิมพ์ดีด', wave: 'คลื่น', rainbow: 'สีรุ้ง' };
const FONTS = ['Noto Sans Thai', 'Kanit', 'Prompt', 'Mitr', 'Sarabun', 'Chakra Petch', 'IBM Plex Sans Thai', 'Bai Jamjuree', 'Athiti', 'Chonburi', 'Pridi', 'Itim', 'Sriracha', 'Mali', 'Charm', 'Leelawadee UI'];
/* text presets = bundles of style props (all editable afterwards) */
const TEXT_PRESETS = {
  pop: { name: 'ขาวขอบดำ', color: '#ffffff', stroke: '#000000', strokeW: .16, shadow: true, font: 'Kanit', weight: 700, hl: '#FFE14D' },
  box: { name: 'กล่องเหลือง', color: '#111111', bg: '#FFE14D', radius: .22, font: 'Kanit', weight: 700, hl: '#E8243C' },
  gold: { name: 'ทองรัตน', color: '#ffffff', bg: 'rgba(11,21,48,.9)', border: '#C9A84C', radius: .35, font: 'Prompt', weight: 700, hl: '#E6C878' },
  glow: { name: 'เรืองแสง', color: '#ffffff', glow: '#2F9BFF', font: 'Kanit', weight: 700, hl: '#9CF7FF' },
  grad: { name: 'ไล่สี', grad: ['#FFF37A', '#FF7A1A'], stroke: '#5a1a00', strokeW: .06, font: 'Chonburi', weight: 400, hl: '#ffffff' },
  bubble: { name: 'ฟองคำพูด', color: '#111111', bg: '#ffffff', radius: .8, tail: true, font: 'Mitr', weight: 500, hl: '#E8501E' },
  sign: { name: 'ป้ายเอียง', color: '#ffffff', bg: '#E8243C', radius: .2, tilt: -4, font: 'Kanit', weight: 700, hl: '#FFE14D' },
  neon: { name: 'นีออนชมพู', color: '#ffffff', glow: '#FF2BD6', font: 'Chakra Petch', weight: 700, hl: '#FFE14D' },
  hand: { name: 'ลายมือ', color: '#ffffff', stroke: '#000000', strokeW: .1, font: 'Sriracha', weight: 400, hl: '#7CFF6B' },
  plain: { name: 'เรียบ', color: '#ffffff', font: 'Noto Sans Thai', weight: 600, shadow: true, hl: '#FFE14D' },
};
const STICKERS = {
  'อารมณ์': ['😀', '😂', '😍', '🥰', '😎', '🤩', '😱', '😭', '🤔', '😴', '🥳', '😡'],
  'ชี้ & ลูกศร': ['👉', '👈', '👆', '👇', '⬆️', '⬇️', '➡️', '⬅️', '↗️', '🔄', '✅', '❌'],
  'ช้อปปิ้ง': ['🛒', '🛍️', '💰', '💸', '🏷️', '🎁', '📦', '🚚', '🏪', '💳', '🧾', '🔖'],
  'อาหาร': ['🍚', '🍜', '🥤', '☕', '🍰', '🍉', '🍳', '🥚', '🧂', '🍶', '🥛', '🍞'],
  'สัญลักษณ์': ['🔥', '⭐', '✨', '💯', '❤️', '⚡', '💡', '📢', '⏰', '📍', '🆕', '🆓'],
  'ฉลอง': ['🎉', '🎊', '🎈', '🏆', '🥇', '👏', '🙌', '💪', '🙏', '👍', '🎯', '🚀'],
};

function itemDur(x) { return x.kind === 'sfx' ? (x.len || 1.5) : (x.out - x.in) / (x.speed || 1); }
function layout(P) {
  const mediaById = Object.fromEntries((P.media || []).map(m => [m.id, m]));
  let t = 0; const clips = [];
  (P.main || []).forEach((c, i) => {
    const d = Math.max(.1, ((c.out ?? 0) - (c.in ?? 0)) / (c.speed || 1));
    const ov = i > 0 && c.trans && c.trans.type && c.trans.type !== 'none' ? Math.min(c.trans.dur || .5, d / 2, clips[i - 1].dur / 2) : 0;
    const start = Math.max(0, t - ov);
    clips.push({ c, i, start, dur: d, end: start + d, ov, m: mediaById[c.mediaId] });
    t = start + d;
  });
  let total = t;
  for (const x of P.items || []) total = Math.max(total, x.e || 0);
  for (const x of P.audio || []) total = Math.max(total, x.s + itemDur(x));
  return { clips, total: Math.max(total, .1), mainEnd: t, mediaById };
}

/* keyframes: base props + [{t,...}] relative to item start, eased */
const KP = ['x', 'y', 'sc', 'rot', 'op'];
function kfAt(x, lt) {
  const base = { x: x.x ?? .5, y: x.y ?? .5, sc: x.sc ?? 1, rot: x.rot ?? 0, op: x.op ?? 1 };
  const k = (x.kf || []).slice().sort((a, b) => a.t - b.t);
  if (!k.length) return base;
  if (lt <= k[0].t) return { ...base, ...pick(k[0], base) };
  for (let i = 0; i < k.length - 1; i++) if (lt <= k[i + 1].t) {
    const a = { ...base, ...pick(k[i], base) }, b = { ...base, ...pick(k[i + 1], base) }, p = eIO(prog(lt, k[i].t, k[i + 1].t - k[i].t));
    const o = {}; KP.forEach(n => o[n] = lerp(a[n], b[n], p)); return o;
  }
  return { ...base, ...pick(k[k.length - 1], base) };
}
function pick(k, base) { const o = {}; KP.forEach(n => { if (k[n] != null) o[n] = k[n]; }); return o; }

/* ── text ── */
function textCSS(x) {
  const fs = x.size || 80, st = [];
  st.push(`font-family:"${x.font || 'Kanit'}","Noto Sans Thai",sans-serif`, `font-weight:${x.weight || 700}`, `font-size:${fs}px`, `letter-spacing:${(x.spacing || 0)}em`);
  if (!x.grad) st.push(`color:${x.color || '#fff'}`);
  if (x.bg) st.push(`background:${x.bg}`, `padding:.1em .45em .24em`, `border-radius:${x.radius ?? .25}em`);
  if (x.border) st.push(`border:.05em solid ${x.border}`);
  const sh = [];
  if (x.shadow) sh.push('0 .07em .18em rgba(0,0,0,.55)');
  if (x.glow) sh.push(`0 0 .1em #fff`, `0 0 .3em ${x.glow}`, `0 0 .7em ${x.glow}`);
  if (sh.length) st.push(`text-shadow:${sh.join(',')}`);
  return st.join(';');
}
function glyphCSS(x) {
  const st = [];
  if (x.stroke && x.strokeW) st.push(`-webkit-text-stroke:${x.strokeW}em ${x.stroke}`, 'paint-order:stroke fill');
  if (x.grad) st.push(`background:linear-gradient(180deg,${x.grad[0]},${x.grad[1]})`, '-webkit-background-clip:text', 'background-clip:text', 'color:transparent');
  return st.join(';');
}
function textHTML(x) {
  const gc = glyphCSS(x);
  if (x.anim === 'karaoke' && x.words && x.words.length) {
    let out = '', lineLen = 0;
    x.words.forEach((w, i) => {
      if (w.br) out += '<br>';
      out += `<span class="w" style="${gc}" data-s="${w.s}" data-e="${w.e}"${w.hl ? ' data-hl="1"' : ''}>${esc(w.t)}</span>`;
    });
    return out;
  }
  return String(x.text || '').split('\n').map(ln => graphemes(ln).map(g => g === ' ' ? '<span class="g sp">&nbsp;</span>' : `<span class="g" style="${gc}">${esc(g)}</span>`).join('')).join('<br>');
}
function animateText(el, x, t) {
  const lt = t - x.s, inP = prog(lt, 0, .25), outP = prog(t, x.e - .15, .15);
  let scale = 1, op = 1;
  if (x.anim === 'karaoke') {
    const hl = x.hl || '#FFE14D';
    el.querySelectorAll('.w').forEach(w => {
      const s = +w.dataset.s, e = +w.dataset.e, on = t >= s && t < Math.max(e, s + .12);
      const lit = on || (w.dataset.hl && t >= s);
      if (x.grad) w.style.filter = on ? 'brightness(1.3)' : ''; else w.style.color = lit ? hl : '';
      w.style.transform = on ? `scale(${lerp(1, 1.12, eBack(prog(t, s, .14)))})` : 'none';
    });
    op = clamp(inP * 3);
  } else {
    const gs = el.querySelectorAll('.g'), n = gs.length || 1, per = Math.min(.05, .6 / n);
    gs.forEach((g, i) => {
      const p = prog(lt, i * per, .3); let tf = '', o = 1;
      switch (x.anim) {
        case 'bounce': tf = `translateY(${(1 - eBack(p)) * 60}px) scale(${lerp(.3, 1, eBack(p))})`; o = clamp(p * 3); break;
        case 'float': tf = `translateY(${(1 - eOut(p)) * 50}px)`; o = p; break;
        case 'drop': tf = `translateY(${(1 - eBack(p)) * -120}px)`; o = clamp(p * 2); break;
        case 'type': o = lt >= i * Math.min(.06, .9 / n) ? 1 : 0; break;
        case 'wave': tf = `translateY(${Math.sin(t * 6 - i * .5) * 14}px)`; break;
      }
      g.style.transform = tf; g.style.opacity = o;
      if (x.anim === 'rainbow') g.style.color = `hsl(${(t * 140 + i * 24) % 360},95%,62%)`; else if (!x.grad && g.style.color) g.style.color = '';
    });
    if (x.anim === 'pop') { scale = lerp(.4, 1, eBack(inP)); op = clamp(inP * 3); }
    else if (x.anim !== 'none' && x.anim !== 'type') op = x.anim === 'wave' || x.anim === 'rainbow' ? clamp(inP * 3) : 1;
  }
  return { scale, op: op * (1 - outP) };
}

const STAGE_CSS = `
.rc-stage{position:relative;overflow:hidden;background:#000}
.rc-layer{position:absolute;inset:0;overflow:hidden}
.rc-layer video,.rc-layer img,.rc-layer canvas{position:absolute;inset:0;width:100%;height:100%}
.rc-item{position:absolute;left:0;top:0;pointer-events:none;transform-origin:50% 50%}
.rc-txt{text-align:center;white-space:pre;line-height:1.25;-webkit-font-smoothing:antialiased}
.rc-txt .g,.rc-txt .w{display:inline-block;transform-origin:50% 70%}
.rc-txt.tail::after{content:'';position:absolute;left:18%;bottom:-.3em;border:.2em solid transparent;border-top:.3em solid var(--tail,#fff);border-bottom:0}
.rc-stk{line-height:1;font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif}
.rc-ov{overflow:hidden}
.rc-ov video,.rc-ov img,.rc-ov canvas{display:block;width:100%;height:100%;object-fit:cover}
.rc-draw{position:absolute;inset:0;pointer-events:none}
.rc-flash{position:absolute;inset:0;pointer-events:none;opacity:0;background:#fff;z-index:9000}
`;

class Stage {
  constructor(root, P, opts = {}) {
    this.root = root; this.mode = opts.mode || 'preview'; this.base = opts.base || '';
    this.vids = {}; this.els = {}; this.ovVids = {};
    if (!document.getElementById('rc-css')) { const s = document.createElement('style'); s.id = 'rc-css'; s.textContent = STAGE_CSS; document.head.appendChild(s); }
    root.classList.add('rc-stage'); root.innerHTML = '<div class="rc-media"></div><div class="rc-over"></div><div class="rc-flash"></div>';
    this.mediaEl = root.children[0]; this.overEl = root.children[1]; this.flashEl = root.children[2];
    this.setProject(P);
  }
  setProject(P) {
    this.P = P; [this.W, this.H] = frameSize(P.ratio, 1080);
    Object.assign(this.root.style, { width: this.W + 'px', height: this.H + 'px' });
    this.L = layout(P); this.dirty = true;
    const ids = new Set(P.main.map(c => c.id));
    for (const k of Object.keys(this.vids)) if (!ids.has(k)) { this.vids[k].wrap.remove(); delete this.vids[k]; }
  }
  murl(file) { return `${this.base}/projects/${this.P.id}/media/${file}`; }
  layer(cl) {
    const m = cl.m; if (!m || !m.ready) return null;
    const src = m.type === 'image' ? m.img : m.proxy; if (!src) return null;
    let v = this.vids[cl.c.id];
    if (v && v.src !== src) { v.wrap.remove(); v = null; }
    if (!v) {
      const wrap = document.createElement('div'); wrap.className = 'rc-layer';
      const el = document.createElement(m.type === 'image' ? 'img' : 'video');
      el.src = this.murl(src);
      if (el.tagName === 'VIDEO') { el.preload = 'auto'; el.playsInline = true; el.muted = this.mode === 'render'; }
      wrap.appendChild(el); this.mediaEl.appendChild(wrap); v = this.vids[cl.c.id] = { wrap, el, src };
    }
    v.el.style.objectFit = cl.c.fit === 'contain' ? 'contain' : 'cover';
    return v;
  }
  build() {
    this.overEl.innerHTML = ''; this.els = {};
    const items = (this.P.items || []).slice().sort((a, b) => (a.lane || 0) - (b.lane || 0));
    for (const x of items) {
      let el;
      if (x.kind === 'text') {
        el = document.createElement('div'); el.className = 'rc-item rc-txt' + (x.tail ? ' tail' : '');
        el.setAttribute('style', textCSS(x)); if (x.tail) el.style.setProperty('--tail', x.bg || '#fff');
        el.innerHTML = textHTML(x);
      } else if (x.kind === 'sticker') {
        el = document.createElement('div'); el.className = 'rc-item rc-stk'; el.style.fontSize = (x.size || 180) + 'px'; el.textContent = x.emoji;
      } else if (x.kind === 'media') {
        el = document.createElement('div'); el.className = 'rc-item rc-ov';
        const m = this.L.mediaById[x.mediaId];
        const w = (x.w || .5) * this.W, h = m && m.w && m.h ? w * m.h / m.w : w * 16 / 9;
        Object.assign(el.style, { width: w + 'px', height: h + 'px', borderRadius: (x.radius || 0) + 'px', border: x.border ? `${x.border}px solid ${x.borderColor || '#fff'}` : '' });
        if (m && m.ready) {
          const src = document.createElement(m.type === 'image' ? 'img' : 'video'); src.src = this.murl(m.type === 'image' ? m.img : m.proxy);
          if (src.tagName === 'VIDEO') { src.preload = 'auto'; src.muted = true; src.playsInline = true; }
          if (x.chroma && x.chroma.on) { const cv = document.createElement('canvas'); cv.width = Math.round(w / 2); cv.height = Math.round(h / 2); src.style.display = 'none'; el.appendChild(src); el.appendChild(cv); }
          else el.appendChild(src);
        }
      } else if (x.kind === 'draw') {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.setAttribute('class', 'rc-draw'); el.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
        el.innerHTML = `<defs><marker id="ah-${x.id}" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="${x.color || '#FF3B30'}"/></marker></defs>` +
          (x.strokes || []).map(st => {
            const pts = st.pts.map(([a, b]) => [a * this.W, b * this.H]);
            const d = (st.tool === 'line' || st.tool === 'arrow') && pts.length ? `M${pts[0]} L${pts[pts.length - 1]}` : 'M' + pts.map(p => p.join(',')).join(' L');
            const op = st.tool === 'hl' ? .38 : 1, w = (st.w || 10) * (st.tool === 'hl' ? 3 : 1);
            return `<path d="${d}" fill="none" stroke="${st.color || x.color || '#FF3B30'}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"${st.tool === 'arrow' ? ` marker-end="url(#ah-${x.id})"` : ''}/>`;
          }).join('');
      }
      if (!el) continue;
      el.dataset.id = x.id; this.overEl.appendChild(el); this.els[x.id] = el;
    }
    this.dirty = false;
  }
  active(t) { return this.L.clips.filter(cl => t >= cl.start && t < cl.end + 1e-6); }
  draw(t, playing = false) {
    if (this.dirty) this.build();
    const waits = [], used = new Set(), seek = (el, time) => {
      if (this.mode === 'render' || !playing) {
        if (Math.abs(el.currentTime - time) > .001) waits.push(new Promise(res => { const d = () => { el.removeEventListener('seeked', d); res(); }; el.addEventListener('seeked', d); el.currentTime = time; }));
        if (!el.paused) el.pause();
      } else { if (Math.abs(el.currentTime - time) > .25) el.currentTime = time; if (el.paused) el.play().catch(() => {}); }
    };
    for (const cl of this.active(t)) {
      const v = this.layer(cl); if (!v) continue; used.add(cl.c.id);
      const lt = t - cl.start, sp = cl.c.speed || 1, mt = (cl.c.in || 0) + lt * sp;
      let op = 1, tf = '', blur = 0, clip = 'none';
      const tr = cl.c.trans?.type || 'none';
      if (cl.ov > 0 && lt < cl.ov) {
        const p = eIO(prog(lt, 0, cl.ov));
        switch (tr) {
          case 'fade': op = p; break;
          case 'black': case 'white': op = lt < cl.ov / 2 ? 0 : prog(lt, cl.ov / 2, cl.ov / 2); break;
          case 'slideL': tf = `translateX(${(1 - p) * 100}%)`; break; case 'slideR': tf = `translateX(${(p - 1) * 100}%)`; break;
          case 'slideU': tf = `translateY(${(1 - p) * 100}%)`; break; case 'slideD': tf = `translateY(${(p - 1) * 100}%)`; break;
          case 'zoom': op = p; tf = `scale(${lerp(1.6, 1, p)})`; break; case 'zoomOut': op = p; tf = `scale(${lerp(.6, 1, p)})`; break;
          case 'blur': op = p; blur = (1 - p) * 30; break; case 'spin': op = p; tf = `rotate(${(1 - p) * -180}deg) scale(${lerp(.3, 1, p)})`; break;
          case 'wipe': clip = `inset(0 ${(1 - p) * 100}% 0 0)`; break; case 'circle': clip = `circle(${p * 75}% at 50% 50%)`; break;
          default: op = p;
        }
      }
      const next = this.L.clips[cl.i + 1];
      if (next && next.ov > 0 && t >= next.start && ['black', 'white'].includes(next.c.trans?.type)) op = Math.min(op, 1 - prog(t - next.start, 0, next.ov / 2));
      let sc = cl.c.punch ? 1.08 : 1;
      for (const z of cl.c.zooms || []) { const a = eOut(prog(lt, z.t, .25)), b = eIO(prog(lt, z.t + z.d, .3)); sc *= lerp(1, z.s || 1.2, a * (1 - b)); }
      const f = cl.c.filter || {};
      const fc = [(FILTERS[f.preset] || FILTERS.none).css, f.b != null && f.b !== 1 ? `brightness(${f.b})` : '', f.c != null && f.c !== 1 ? `contrast(${f.c})` : '', f.s != null && f.s !== 1 ? `saturate(${f.s})` : '',
        f.temp ? (f.temp > 0 ? `sepia(${f.temp * .5})` : `hue-rotate(${f.temp * 25}deg)`) : '', blur ? `blur(${blur}px)` : ''].join(' ').trim();
      Object.assign(v.wrap.style, { opacity: op, transform: `${tf} scale(${sc})`, filter: fc || 'none', clipPath: clip, zIndex: cl.i + 1, visibility: 'visible' });
      if (v.el.tagName === 'VIDEO') { v.el.volume = clamp(cl.c.vol ?? 1); v.el.playbackRate = sp; seek(v.el, mt); }
    }
    for (const [k, v] of Object.entries(this.vids)) if (!used.has(k)) { v.wrap.style.visibility = 'hidden'; if (v.el.tagName === 'VIDEO' && !v.el.paused) v.el.pause(); }
    let fl = 0; for (const cl of this.L.clips) if (cl.ov > 0 && cl.c.trans?.type === 'white') { const d = Math.abs(t - (cl.start + cl.ov / 2)); if (d < cl.ov / 2) fl = Math.max(fl, 1 - d / (cl.ov / 2)); }
    this.flashEl.style.opacity = fl;
    // overlay items
    for (const x of this.P.items || []) {
      const el = this.els[x.id]; if (!el) continue;
      const on = t >= x.s && t < x.e; el.style.display = on ? '' : 'none';
      const vid = x.kind === 'media' ? el.querySelector('video') : null;
      if (!on) { if (vid && !vid.paused) vid.pause(); continue; }
      const lt = t - x.s, k = kfAt(x, lt);
      let extraS = 1, extraO = 1, rot = k.rot + (x.tilt || 0);
      if (x.kind === 'text') { const a = animateText(el, x, t); extraS = a.scale; extraO = a.op; }
      else if (x.kind === 'sticker') { const p = prog(lt, 0, .35); extraS = lerp(.2, 1, eBack(p)) * (x.anim === 'pulse' ? 1 + Math.sin(t * 6) * .06 : 1); extraO = clamp(p * 2) * (1 - prog(t, x.e - .15, .15)); if (x.anim === 'wobble') rot += Math.sin(t * 5) * 8; if (x.anim === 'spin') rot += lt * 120; }
      else if (x.kind === 'media') { const p = prog(lt, 0, .3); extraO = clamp(p * 2) * (1 - prog(t, x.e - .2, .2)); if (vid) { vid.playbackRate = 1; seek(vid, (x.in || 0) + lt); } this.chroma(el, x); }
      else if (x.kind === 'draw') { const p = prog(lt, 0, .6); el.querySelectorAll('path').forEach(pa => { if (pa.parentNode.tagName === 'marker') return; const L = pa.getTotalLength ? pa.getTotalLength() : 1000; pa.style.strokeDasharray = L; pa.style.strokeDashoffset = L * (1 - eOut(p)); }); extraO = 1 - prog(t, x.e - .2, .2); el.style.opacity = extraO; continue; }
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.transform = `translate(${k.x * this.W - w / 2}px,${k.y * this.H - h / 2}px) rotate(${rot}deg) scale(${k.sc * extraS})`;
      el.style.opacity = clamp(k.op * extraO);
      el.style.zIndex = 100 + (x.lane || 0);
    }
    return waits.length ? Promise.all(waits) : null;
  }
  chroma(el, x) {
    const cv = el.querySelector('canvas'), src = el.querySelector('video,img'); if (!cv || !src) return;
    const g = cv.getContext('2d', { willReadFrequently: true });
    try { g.drawImage(src, 0, 0, cv.width, cv.height); } catch { return; }
    const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data;
    const hex = (x.chroma.color || '#00ff00').replace('#', ''), kr = parseInt(hex.slice(0, 2), 16), kg = parseInt(hex.slice(2, 4), 16), kb = parseInt(hex.slice(4, 6), 16);
    const tol = (x.chroma.tol ?? .35) * 255, soft = Math.max(1, (x.chroma.soft ?? .1) * 255);
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.sqrt((d[i] - kr) ** 2 + (d[i + 1] - kg) ** 2 + (d[i + 2] - kb) ** 2) / 1.732;
      if (dist < tol) d[i + 3] = 0; else if (dist < tol + soft) d[i + 3] = Math.round(255 * (dist - tol) / soft);
    }
    g.putImageData(img, 0, 0);
  }
  stopAll() { for (const v of Object.values(this.vids)) if (v.el.tagName === 'VIDEO' && !v.el.paused) v.el.pause(); this.overEl.querySelectorAll('video').forEach(v => v.pause()); }
}

/* offline mix used by the export renderer */
async function buildAudio(ctx, P, base = '') {
  const L = layout(P), cache = {};
  const load = url => { if (!cache[url]) cache[url] = fetch(base + url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)); return cache[url]; };
  const out = ctx.createGain(); out.connect(ctx.destination);
  const speech = [];
  for (const cl of L.clips) {
    const m = cl.m; if (!m || !m.wav || (cl.c.vol ?? 1) <= 0) continue;
    const buf = await load(`/projects/${P.id}/media/${m.wav}`);
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.playbackRate.value = cl.c.speed || 1; src.connect(g).connect(out);
    const v = cl.c.vol ?? 1, a = cl.start, e = cl.end, nxt = L.clips[cl.i + 1], fi = Math.max(.01, cl.ov || .01), fo = Math.max(.01, nxt ? nxt.ov || .01 : .01);
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(v, a + fi); g.gain.setValueAtTime(v, Math.max(a + fi, e - fo)); g.gain.linearRampToValueAtTime(0, e);
    src.start(a, cl.c.in || 0, cl.dur * (cl.c.speed || 1)); speech.push([a, e]);
  }
  for (const x of P.items || []) if (x.kind === 'media' && x.vol > 0) {
    const m = L.mediaById[x.mediaId]; if (!m || !m.wav) continue;
    const buf = await load(`/projects/${P.id}/media/${m.wav}`), src = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = x.vol; src.buffer = buf; src.connect(g).connect(out); src.start(x.s, x.in || 0, x.e - x.s);
  }
  for (const x of P.audio || []) {
    try {
      const url = x.kind === 'sfx' ? `/sfx/${x.file}` : `/projects/${P.id}/media/${(L.mediaById[x.mediaId] || {}).wav}`;
      const buf = await load(url), src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.playbackRate.value = x.speed || 1; src.connect(g).connect(out);
      const v = x.vol ?? (x.kind === 'music' ? .35 : x.kind === 'sfx' ? .7 : 1), s = x.s, e = x.kind === 'sfx' ? s + buf.duration : s + itemDur(x);
      if (x.kind === 'music') {
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(v, s + .5);
        if (x.duck !== false && P.settings?.duck !== false) for (const [a, b] of speech) { if (b < s || a > e) continue; g.gain.setTargetAtTime(v * .28, Math.max(s + .5, a - .2), .12); g.gain.setTargetAtTime(v, b, .3); }
        g.gain.setTargetAtTime(0, Math.max(s, e - 1.2), .35);
      } else g.gain.value = v;
      if (x.kind === 'sfx') src.start(s); else src.start(s, x.in || 0, (e - s) * (x.speed || 1));
    } catch (err) { console.warn('audio', x, err); }
  }
}

window.RC = { layout, Stage, buildAudio, frameSize, kfAt, itemDur, RATIOS, FILTERS, TRANS, TEXT_ANIMS, TEXT_PRESETS, FONTS, STICKERS, graphemes, clamp, prog, lerp };
})();
