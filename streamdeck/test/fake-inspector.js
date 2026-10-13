// Electron test: plays the Stream Deck software for plugin + property inspector, then screenshots the inspector.
// Usage: PO_API_FILE=<api.json> npx electron streamdeck/test/fake-inspector.js <out.png> [type] [source] [category]
const { app, BrowserWindow } = require('electron');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ACTION = 'de.frequenzbetrieb.pluginorganizer.load';
const CTX = 'key-1';
// Arguments after the script path ('-' = empty); refuse to run without an explicit .png target.
const scriptAt = process.argv.findIndex((a) => a.endsWith('fake-inspector.js'));
const [out, type = '', source = '', category = ''] = process.argv.slice(scriptAt + 1).map((a) => (a === '-' ? '' : a));
if (scriptAt < 0 || !out || !out.endsWith('.png')) { console.error('Aufruf: … fake-inspector.js <ziel.png> [typ] [quelle] [kategorie]'); process.exit(2); }
const sdp = path.join(__dirname, '..', 'de.frequenzbetrieb.pluginorganizer.sdPlugin');

let pluginWs;
let inspectorWs;
let settings = { filter: { type, source, category } };
const wss = new WebSocketServer({ port: 0 });
wss.on('connection', (ws) => {
  ws.once('message', (raw) => {
    const reg = JSON.parse(raw);
    if (reg.event === 'registerPlugin') {
      pluginWs = ws;
      ws.send(JSON.stringify({ event: 'willAppear', action: ACTION, context: CTX, payload: { settings } }));
      ws.on('message', (r) => { const m = JSON.parse(r); if (m.event === 'sendToPropertyInspector') inspectorWs?.send(JSON.stringify(m)); });
    } else {
      inspectorWs = ws;
      ws.on('message', (r) => {
        const m = JSON.parse(r);
        if (m.event === 'sendToPlugin') pluginWs.send(JSON.stringify({ ...m, context: CTX }));
        if (m.event === 'setSettings') { settings = m.payload; pluginWs.send(JSON.stringify({ event: 'didReceiveSettings', action: ACTION, context: CTX, payload: { settings } })); }
      });
    }
  });
});

// Electron's own binary runs the plugin as plain Node (like the Stream Deck software's Node runtime).
const child = spawn(process.execPath, [path.join(sdp, 'bin', 'plugin.js'), '-port', String(wss.address().port), '-pluginUUID', 'P', '-registerEvent', 'registerPlugin', '-info', '{}'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 360, height: 640, show: false, backgroundColor: '#2d2d2d' });
  await win.loadFile(path.join(sdp, 'ui', 'load.html'));
  await new Promise((r) => setTimeout(r, 800));
  const actionInfo = JSON.stringify({ action: ACTION, context: CTX, payload: { settings } });
  await win.webContents.executeJavaScript(`connectElgatoStreamDeckSocket(${wss.address().port}, 'PI', 'registerPropertyInspector', ${JSON.stringify(JSON.stringify({ application: { language: process.env.SD_LANG || 'de' } }))}, ${JSON.stringify(actionInfo)})`);
  await new Promise((r) => setTimeout(r, 2500));
  fs.writeFileSync(out, (await win.capturePage()).toPNG());
  child.kill();
  app.quit();
});
