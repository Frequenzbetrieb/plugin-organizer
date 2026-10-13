// Electron test: simulates a 15-key Stream Deck running the browser profile and draws the keys as an image.
// Usage: PO_API_FILE=<api.json> npx electron "$PWD/streamdeck/test/fake-deck.js" <outdir> [presses]
//   presses: comma-separated steps, e.g. "0,3,next" = press key 0, then key 3, then ▶ (also: prev, back)
const { app, BrowserWindow } = require('electron');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptAt = process.argv.findIndex((a) => a.endsWith('fake-deck.js'));
const [outDir, steps = ''] = process.argv.slice(scriptAt + 1);
if (scriptAt < 0 || !outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) { console.error('Aufruf: … fake-deck.js <ordner> [schritte]'); process.exit(2); }

const UUID = 'de.frequenzbetrieb.pluginorganizer';
const sdp = path.join(__dirname, '..', `${UUID}.sdPlugin`);
const DEVICE = 'DECK1';
const keys = {}; // "col,row" → { context, image, title }
let pluginWs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tx = (m) => pluginWs.send(JSON.stringify(m));

const wss = new WebSocketServer({ port: 0 });
wss.on('connection', (ws) => {
  pluginWs = ws;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const k = Object.values(keys).find((x) => x.context === m.context);
    if (m.event === 'setImage' && k) k.image = m.payload.image;
    if (m.event === 'setTitle' && k) k.title = m.payload.title;
    if (m.event === 'switchToProfile') { console.log('switchToProfile →', JSON.stringify(m.payload)); if (m.payload.profile) showProfile(); }
    if ((m.event === 'showOk' || m.event === 'showAlert') && k) console.log(m.event, 'auf', k.pos);
  });
});

// Lay out the browser profile's actions (as in the generated manifest) and let them "appear".
function showProfile() {
  const prof = fs.readdirSync(path.join(__dirname, '..', '.check')).find((f) => f.endsWith('.sdProfile'));
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.check', prof, 'manifest.json'), 'utf8'));
  for (const [pos, a] of Object.entries(man.Actions)) {
    const [column, row] = pos.split(',').map(Number);
    const context = `ctx-${pos}`;
    keys[pos] = { pos, context, action: a.UUID, image: '', title: '' };
    tx({ event: 'willAppear', action: a.UUID, context, device: DEVICE, payload: { settings: a.Settings || {}, coordinates: { column, row } } });
  }
}

async function press(pos, holdMs = 50) {
  const k = keys[pos];
  tx({ event: 'keyDown', action: k.action, context: k.context, device: DEVICE, payload: {} });
  await sleep(holdMs);
  tx({ event: 'keyUp', action: k.action, context: k.context, device: DEVICE, payload: {} });
}

async function snapshot(win, name) {
  await sleep(2500);
  const cells = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const k = keys[`${col},${row}`] || {};
    cells.push(`<div class="k" style="background:${k.action?.endsWith('.nav') ? '#22252e' : '#14151a'}">${k.image ? `<img src="${k.image}">` : ''}<span>${(k.title || '').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</span></div>`);
  }
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>body{margin:0;background:#000;padding:14px;display:grid;grid-template-columns:repeat(5,96px);gap:12px}
    .k{width:96px;height:96px;border-radius:12px;position:relative;overflow:hidden;color:#fff;font:600 11px -apple-system;text-align:center}
    .k img{width:96px;height:96px;position:absolute;inset:0}.k span{position:absolute;left:2px;right:2px;bottom:4px;text-shadow:0 1px 2px #000}</style>${cells.join('')}`)}`);
  await sleep(300);
  fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.capturePage()).toPNG());
  console.log('Bild', name);
}

app.whenReady().then(async () => {
  // Unpack the generated profile so the test uses exactly what ships.
  const check = path.join(__dirname, '..', '.check');
  fs.rmSync(check, { recursive: true, force: true });
  fs.mkdirSync(check);
  require('child_process').execFileSync('ditto', ['-x', '-k', path.join(sdp, 'profiles', 'Frequenzbetrieb Browser.streamDeckProfile'), check]);

  const child = spawn(process.execPath, [path.join(sdp, 'bin', 'plugin.js'), '-port', String(wss.address().port), '-pluginUUID', 'PLUGIN', '-registerEvent', 'registerPlugin', '-info', '{}'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  const win = new BrowserWindow({ width: 560, height: 360, show: false });
  while (!pluginWs) await sleep(100);
  await sleep(300);
  // "Browser öffnen" key on the normal profile.
  tx({ event: 'willAppear', action: `${UUID}.browse`, context: 'open', device: DEVICE, payload: { settings: {}, coordinates: { column: 0, row: 0 } } });
  tx({ event: 'keyDown', action: `${UUID}.browse`, context: 'open', device: DEVICE, payload: {} });
  await snapshot(win, '0-uebersicht');
  let n = 1;
  for (const step of steps.split(',').filter(Boolean)) {
    if (step === 'next') await press('4,1');
    else if (step === 'prev') await press('4,0');
    else if (step === 'back') await press('4,2');
    else { const i = Number(step); await press(`${i % 4},${Math.floor(i / 4)}`); }
    await snapshot(win, `${n++}-${step}`);
  }
  child.kill();
  fs.rmSync(check, { recursive: true, force: true });
  app.quit();
});
