// Runs one demo (PO_DEMO=<name>) inside the dev app and writes docs/videos/<lang>/<name>.mp4 (+ .jpg poster).
// Usage: PO_USERDATA=<copy of data> PO_DEMO=suche PO_DEMO_LANG=de npx electron .
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const { HELPERS, startCapture, encode, sleep } = require('./recorder');

const ROOT = path.join(__dirname, '..', '..');
const LIVECAPTURE = path.join(ROOT, 'bin', 'livecapture');
const run = (cmd, args) => new Promise((r) => execFile(cmd, args, { maxBuffer: 1 << 24 }, (e, out) => r(e ? null : out)));

// Runs steps in a page with the demo helpers (D = window.__demo).
const stepper = (wc) => async (js) => {
  await wc.executeJavaScript(HELPERS);
  return wc.executeJavaScript(`(async () => { const D = window.__demo; const w = (ms) => new Promise((r) => setTimeout(r, ms)); ${js} })()`);
};

// Frames of Live's main window (for the side-by-side "loading" video).
function captureLive(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  let running = true;
  const loop = (async () => {
    const wins = JSON.parse((await run(LIVECAPTURE, ['windows'])) || '[]').filter((w) => w.w > 500 && w.h > 300);
    // The window that shows the device view is the one with a track selected – take the larger one with a title.
    const live = wins.sort((a, b) => (b.title ? 1 : 0) - (a.title ? 1 : 0) || b.w * b.h - a.w * a.h)[0];
    while (running && live) {
      const t = Date.now();
      const file = path.join(dir, `l${String(frames.length).padStart(5, '0')}.png`);
      if (await run(LIVECAPTURE, ['capture', String(live.id), file])) frames.push({ file, t });
    }
  })();
  return async () => { running = false; await loop; return frames; };
}

// Clean starting point: keyboard folded away, no filters, grid view.
const PRELUDE = `if (!document.querySelector('.keyboard-panel').classList.contains('collapsed')) document.querySelector('#toggleKb').click();
  document.querySelector('#typeTabs button')?.click(); D.clear('#search'); await w(500);`;

const DEMOS = {
  // Library: browse the grid, categories, forgiving search.
  async bibliothek({ win, out, tmp }) {
    const s = stepper(win.webContents);
    const stop = startCapture(win.webContents, tmp);
    await s(`${PRELUDE} await w(900); await D.hover('.card:nth-child(2)'); await w(400); await D.hover('.card:nth-child(7)'); await w(400); await D.hover('.card:nth-child(4)'); await w(600);
      await D.click('#viewTabs button:nth-child(1)'); await w(1400);
      await D.hover('.cattile:nth-child(2)'); await w(500); await D.click('.cattile:nth-child(2)'); await w(1600);
      await D.click('#typeTabs button:nth-child(1)'); await D.click('#viewTabs button:nth-child(3)'); await w(600);
      await D.click('#search'); await D.type('#search', 'valhala'); await w(1600);
      D.clear('#search'); await w(300); await D.type('#search', 'proq'); await w(1600);
      D.clear('#search'); await w(700);`);
    await encode(await (await stop)(), out, { poster: 3 });
  },

  // Quick search window over Live's interface (Live window as background).
  async schnellsuche({ ctx, out, tmp }) {
    ctx.toggleQuick();
    await sleep(1800);
    const q = ctx.getQuick();
    const s = stepper(q.webContents);
    const stop = startCapture(q.webContents, tmp);
    await s(`D.clear('#q'); await w(1400); await D.type('#q', 'valhala', 7); await w(1200);
      D.key('ArrowDown'); await w(500); D.key('ArrowDown'); await w(700); D.key('ArrowUp'); await w(700);
      D.clear('#q'); await w(400); await D.type('#q', 'eq', 6); await w(1500);`);
    const frames = await (await stop)();
    // Background: a still of Live (if running), slightly dimmed.
    const bg = path.join(tmp, 'bg.png');
    const wins = JSON.parse((await run(LIVECAPTURE, ['windows'])) || '[]').filter((w) => w.w > 500 && w.title);
    if (wins[0]) await run(LIVECAPTURE, ['capture', String(wins[0].id), bg]);
    await encode(frames, out, { poster: 3, background: fs.existsSync(bg) ? bg : null });
    ctx.hideQuick();
  },

  // Right-click menu, rating, chains.
  async ketten({ win, out, tmp }) {
    const s = stepper(win.webContents);
    const stop = startCapture(win.webContents, tmp);
    await s(`${PRELUDE} await w(700); await D.rclick('.card:nth-child(1)'); await w(900);
      await D.hover('.menu [data-a=rate][data-v="4"]', 700); await w(600);
      await D.hover('.menu [data-a=chain]', 600); await w(700);
      await D.hover('.menu [data-a=notes]', 600); await w(500);
      document.body.click(); await w(500);
      await D.rclick('#chains li'); await w(1500);
      await D.hover('.menu [data-a=up]', 700); await w(900);
      document.body.click(); await w(400);
      await D.move('#chains li', 600); await w(1200);`);
    await encode(await (await stop)(), out, { poster: 2.5, crop: [0, 0.04, 0.72, 0.94], width: 1280, height: 1000 });
  },

  // Loading into Live: the app on the left, Live on the right.
  async laden({ win, out, tmp }) {
    const s = stepper(win.webContents);
    const appDir = path.join(tmp, 'app');
    const stopApp = startCapture(win.webContents, appDir);
    const stopLive = captureLive(path.join(tmp, 'live'));
    await s(`${PRELUDE} await w(600); await D.click('#search'); await D.type('#search', 'eq eight', 8); await w(700);
      await D.click('.card', { shiftKey: true }); await w(2200);
      D.clear('#search'); await D.type('#search', 'compressor', 9); await w(600); await D.click('.card'); await w(2000);
      D.clear('#search'); await D.type('#search', 'reverb', 9); await w(600); await D.click('.card'); await w(2400);
      D.clear('#search'); await w(500);`);
    const appFrames = await (await stopApp)();
    const liveFrames = await (await stopLive)();
    await encodeSideBySide(appFrames, liveFrames, out, tmp);
  },

  // Phone remote in a phone-sized window.
  async handy({ ctx, out, tmp, lang }) {
    const port = ctx.remotePort();
    const key = ctx.settings().remoteKey;
    const phone = new BrowserWindow({ width: 400, height: 800, show: false, backgroundColor: '#14151a' });
    phone.webContents.session.setUserAgent(phone.webContents.getUserAgent());
    await phone.loadURL(`http://127.0.0.1:${port}/?k=${key}&lang=${lang}`);
    await sleep(2500);
    const s = stepper(phone.webContents);
    const stop = startCapture(phone.webContents, tmp);
    const t = (de, en) => (lang === 'en' ? en : de);
    await s(`await w(1200); await D.click(D.byText('#grid .tile', '${t('Effekte', 'Effects')}')); await w(2000);
      await D.click(D.byText('#grid .tile', 'EQ')); await w(1800);
      const first = document.querySelector('#grid .tile'); if (first && /^(Alle|All) /.test(first.textContent.trim())) { await D.click(first); await w(1800); }
      await D.hover('#grid .tile:nth-child(3)'); await w(700); await D.click('#newTrack'); await w(900); await D.click('#newTrack'); await w(600);
      await D.click('#back'); await w(1200); await D.click('#back'); await w(1000); await D.click('#back'); await w(900);
      await D.click('#q'); await D.type('#q', 'valhala', 7); await w(1800);`);
    await encode(await (await stop)(), out, { poster: 4, width: 540, height: 1080 });
    phone.close();
  },
};

// Two frame streams → one video, app left and Live right, same height.
async function encodeSideBySide(appFrames, liveFrames, out, tmp) {
  const a = path.join(tmp, 'a.mp4');
  const b = path.join(tmp, 'b.mp4');
  await encode(appFrames, a, { width: 1152, height: 720 });
  await encode(liveFrames, b, { width: 1296, height: 720, crop: [0, 0.5, 0.56, 0.5] });
  await new Promise((r) => execFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex',
    '[0:v][1:v]hstack=inputs=2,scale=1920:-2,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', '-shortest', '-an', out], r));
  await new Promise((r) => execFile('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '5', '-i', out, '-frames:v', '1', '-q:v', '3', out.replace(/\.mp4$/, '.jpg')], r));
}

module.exports = async function runDemo(ctx) {
  const name = process.env.PO_DEMO;
  const lang = process.env.PO_DEMO_LANG || 'de';
  const demo = DEMOS[name];
  if (!demo) throw new Error(`Unbekannte Demo: ${name} (${Object.keys(DEMOS).join(', ')})`);
  const outDir = path.join(ROOT, 'docs', 'videos', lang);
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `po-demo-${name}-`));
  try {
    await demo({ ctx, win: ctx.win, out: path.join(outDir, `${name}.mp4`), tmp, lang });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
