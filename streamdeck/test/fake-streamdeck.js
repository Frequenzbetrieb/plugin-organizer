// Stand-in for the Elgato Stream Deck software: runs the plugin and plays a scripted session.
// Usage: PO_API_FILE=<api.json> node streamdeck/test/fake-streamdeck.js [--press <query>]
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const ACTION = 'de.frequenzbetrieb.pluginorganizer.load';
const CTX = 'key-0-0';
const pressQuery = process.argv.includes('--press') ? process.argv[process.argv.indexOf('--press') + 1] : null;
const wss = new WebSocketServer({ port: 0 });
const port = wss.address().port;
const log = (...a) => console.log(...a);
const waitFor = (ws, pred, ms = 8000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), ms);
  const on = (raw) => { const m = JSON.parse(raw); if (pred(m)) { clearTimeout(t); ws.off('message', on); resolve(m); } };
  ws.on('message', on);
});
const short = (m) => JSON.stringify(m, (k, v) => (typeof v === 'string' && v.startsWith('data:image') ? `<${v.length} Bytes Bild>` : v));

wss.on('connection', async (ws) => {
  const reg = await waitFor(ws, (m) => m.event === 'registerPlugin');
  log('1 angemeldet:', reg.uuid);
  const tx = (m) => ws.send(JSON.stringify(m));

  tx({ event: 'willAppear', action: ACTION, context: CTX, device: 'dev', payload: { settings: {}, coordinates: { column: 0, row: 0 } } });
  log('2 leere Taste →', short(await waitFor(ws, (m) => m.event === 'setTitle')));

  tx({ event: 'sendToPlugin', action: ACTION, context: CTX, payload: { event: 'status' } });
  log('3 Status →', short((await waitFor(ws, (m) => m.event === 'sendToPropertyInspector')).payload));

  tx({ event: 'sendToPlugin', action: ACTION, context: CTX, payload: { event: 'search', q: pressQuery || 'jun-6' } });
  const res = (await waitFor(ws, (m) => m.event === 'sendToPropertyInspector' && m.payload.event === 'results')).payload;
  log('4 Suche →', res.plugins.slice(0, 3).map((p) => `${p.name} (${p.vendor})`).join(', '));

  const pick = res.plugins.find((p) => (pressQuery ? p.name.toLowerCase() === pressQuery : /jun-6 v/i.test(p.name))) || res.plugins[0];
  tx({ event: 'didReceiveSettings', action: ACTION, context: CTX, payload: { settings: { pluginId: pick.id, pluginName: pick.name } } });
  const img = await waitFor(ws, (m) => m.event === 'setImage');
  const title = await waitFor(ws, (m) => m.event === 'setTitle');
  log('5 Plugin gewählt →', pick.name, '| Bild:', img.payload.image ? `${img.payload.image.length} Bytes` : 'keins', '| Titel:', JSON.stringify(title.payload.title));
  require('fs').writeFileSync(path.join(__dirname, 'last-key.png'), Buffer.from(img.payload.image.split(',')[1], 'base64'));

  tx({ event: 'didReceiveSettings', action: ACTION, context: 'bad', payload: { settings: { pluginId: 'gibt-es-nicht' } } });
  tx({ event: 'keyDown', action: ACTION, context: 'bad', payload: {} });
  log('6 Taste mit unbekanntem Plugin →', (await waitFor(ws, (m) => m.context === 'bad' && /^show/.test(m.event))).event);

  if (pressQuery) {
    tx({ event: 'keyDown', action: ACTION, context: CTX, payload: {} });
    log('7 echter Tastendruck →', (await waitFor(ws, (m) => m.context === CTX && /^show/.test(m.event), 30000)).event);
  }
  child.kill();
  process.exit(0);
});

const bundle = path.join(__dirname, '..', 'de.frequenzbetrieb.pluginorganizer.sdPlugin', 'bin', 'plugin.js');
const child = spawn(process.execPath, [bundle, '-port', String(port), '-pluginUUID', 'TESTUUID', '-registerEvent', 'registerPlugin', '-info', '{}'], { stdio: 'inherit' });
setTimeout(() => { log('ABBRUCH: Zeitüberschreitung'); child.kill(); process.exit(1); }, 60000);
