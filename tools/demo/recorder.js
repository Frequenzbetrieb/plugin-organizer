// Records short demo videos of the app (development only, not shipped).
// Started by main.js when PO_DEMO=<name> is set; the demo steps live in tools/demo/demos.js.
// Frames come from the app's own windows (no screen recording), ffmpeg turns them into an MP4.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake cursor + helpers injected into a page: move, click, right-click, type, key.
const HELPERS = `(() => {
  if (window.__demo) return;
  const c = document.createElement('div');
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9.5 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))', transition: 'none' });
  document.body.appendChild(c);
  let x = innerWidth * 0.6, y = innerHeight * 0.55;
  const place = () => { c.style.left = x + 'px'; c.style.top = y + 'px'; };
  place();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const pos = (t) => {
    if (typeof t === 'object' && t && 'x' in t) return t;
    const el = typeof t === 'string' ? document.querySelector(t) : t;
    if (!el) throw new Error('not found: ' + t);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2, el };
  };
  const move = (t, ms = 650) => new Promise((res) => {
    const p = pos(t); const x0 = x, y0 = y; const t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / ms); const e = ease(k); x = x0 + (p.x - x0) * e; y = y0 + (p.y - y0) * e; place(); k < 1 ? requestAnimationFrame(step) : res(p); };
    requestAnimationFrame(step);
  });
  const ripple = () => {
    const r = document.createElement('div');
    Object.assign(r.style, { position: 'fixed', left: (x - 18) + 'px', top: (y - 18) + 'px', width: '36px', height: '36px', borderRadius: '50%', border: '3px solid #ff7a3d', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out', transform: 'scale(.3)', opacity: '1' });
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 500);
  };
  const mouse = (type, el, extra = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
  window.__demo = {
    move,
    async hover(t, ms) { const p = await move(t, ms); const el = p.el || document.elementFromPoint(x, y); mouse('mouseover', el); mouse('mouseenter', el); mouse('mousemove', el); return el; },
    async click(t, extra = {}) { const p = await move(t); await new Promise((r) => setTimeout(r, 120)); ripple(); const el = document.elementFromPoint(x, y) || p.el; mouse('mousedown', el, extra); mouse('mouseup', el, extra); mouse('click', el, extra); },
    // Element by its visible text (first match inside sel).
    byText(sel, text) { return [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().toLowerCase().includes(text.toLowerCase())); },
    async rclick(t) { const p = await move(t); await new Promise((r) => setTimeout(r, 120)); ripple(); const el = document.elementFromPoint(x, y) || p.el; mouse('contextmenu', el); },
    async type(t, text, cps = 9) {
      const el = typeof t === 'string' ? document.querySelector(t) : t; el.focus();
      for (const ch of text) { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 1000 / cps + Math.random() * 40)); }
    },
    clear(t) { const el = document.querySelector(t); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); },
    key(key, opts = {}) { const target = document.activeElement || document.body; target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })); },
    scroll(sel, dy, ms = 900) { const el = document.querySelector(sel); const y0 = el.scrollTop; const t0 = performance.now(); return new Promise((res) => { const s = (n) => { const k = Math.min(1, (n - t0) / ms); el.scrollTop = y0 + dy * ease(k); k < 1 ? requestAnimationFrame(s) : res(); }; requestAnimationFrame(s); }); },
  };
})()`;

// Captures frames of one webContents as fast as it can (max ~25/s), with timestamps for exact timing.
function startCapture(wc, dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const t = Date.now();
      try {
        const img = await wc.capturePage();
        const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
        fs.writeFileSync(file, (opts.width ? img.resize({ width: opts.width, quality: 'best' }) : img).toJPEG(90));
        frames.push({ file, t });
      } catch { /* window busy/resizing */ }
      const dt = Date.now() - t;
      if (dt < 40) await sleep(40 - dt);
    }
  })();
  return async () => { running = false; await loop; return frames; };
}

// Frames + timestamps → MP4 (fixed size, letterboxed on the app's dark background) + poster.
function encode(frames, out, { width = 1280, height = 800, poster, background, crop } = {}) {
  return new Promise((resolve, reject) => {
    const list = `${out}.txt`;
    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const d = ((frames[i + 1]?.t ?? frames[i].t + 1500) - frames[i].t) / 1000;
      lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(3)}`);
    }
    lines.push(`file '${frames[frames.length - 1].file}'`);
    fs.writeFileSync(list, lines.join('\n'));
    // crop = [x, y, w, h] as fractions of the frame – zooms into the interesting part.
    const cf = crop ? `crop=iw*${crop[2]}:ih*${crop[3]}:iw*${crop[0]}:ih*${crop[1]},` : '';
    const vf = `${cf}scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x14151a,fps=30,format=yuv420p`;
    // With a background: the frames float (60 % width) over a dimmed still, like a window over Live.
    const args = background
      ? ['-y', '-loglevel', 'error', '-loop', '1', '-i', background, '-f', 'concat', '-safe', '0', '-i', list, '-filter_complex',
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=brightness=-0.18[bg];[1:v]scale=${Math.round(width * 0.55)}:-2:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/3:shortest=1,fps=30,format=yuv420p`]
      : ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', vf];
    execFile('ffmpeg', [...args, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', '-an', out], (err) => {
      fs.rmSync(list, { force: true });
      if (err) return reject(err);
      if (!poster) return resolve();
      execFile('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(poster), '-i', out, '-frames:v', '1', '-q:v', '3', out.replace(/\.mp4$/, '.jpg')], () => resolve());
    });
  });
}

module.exports = { HELPERS, startCapture, encode, sleep };
