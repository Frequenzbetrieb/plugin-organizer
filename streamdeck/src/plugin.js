// Stream Deck plugin "Frequenzbetrieb Plugin Organizer".
// Speaks the Stream Deck WebSocket protocol directly and talks to the Plugin Organizer through its
// local interface (api.json in the app's data folder: port + key, 127.0.0.1 only).
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ACTION_LOAD = 'de.frequenzbetrieb.pluginorganizer.load';

// ---------- arguments from the Stream Deck software ----------
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^-/, '')] = process.argv[i + 1];

// ---------- Plugin Organizer interface ----------
function apiFile() {
  if (process.env.PO_API_FILE) return process.env.PO_API_FILE; // tests
  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'Plugin Organizer', 'api.json');
}

function api(method, route, body) {
  return new Promise((resolve) => {
    let conf;
    try { conf = JSON.parse(fs.readFileSync(apiFile(), 'utf8')); } catch { return resolve({ offline: true }); }
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: conf.port, path: route, method, timeout: method === 'POST' ? 20000 : 5000,
      headers: { 'X-Token': conf.token, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, ...JSON.parse(out) }); } catch { resolve({ status: res.statusCode }); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ offline: true }));
    if (data) req.write(data);
    req.end();
  });
}

// ---------- Stream Deck connection ----------
const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);
const send = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const keys = new Map(); // context → { action, settings }

ws.on('open', () => send({ event: args.registerEvent, uuid: args.pluginUUID }));

// Short two-line title for a 72 pt key: drop vendor prefix and variant suffixes, break near the middle.
function keyTitle(name) {
  let n = String(name).replace(/\s*\((m|s|m->s|mono|stereo)\)\s*$/i, '').replace(/^(FabFilter|UAD|Waves)\s+/i, '');
  if (n.length <= 10) return n;
  const words = n.split(/\s+/);
  if (words.length === 1) return n.length > 12 ? `${n.slice(0, 11)}…` : n;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  const cut = (s) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);
  return `${cut(words.slice(0, best).join(' '))}\n${cut(words.slice(best).join(' '))}`;
}

async function refresh(context) {
  const key = keys.get(context);
  if (!key) return;
  const s = key.settings || {};
  if (!s.pluginId) {
    send({ event: 'setImage', context, payload: { image: '', target: 0 } });
    send({ event: 'setTitle', context, payload: { title: 'Plugin\nwählen', target: 0 } });
    return;
  }
  const showName = s.showName !== false;
  const r = await api('GET', `/image?id=${encodeURIComponent(s.pluginId)}&size=144&title=${showName ? 1 : 0}`);
  if (r.offline) {
    send({ event: 'setTitle', context, payload: { title: 'Organizer\nstarten', target: 0 } });
    return;
  }
  send({ event: 'setImage', context, payload: { image: r.image || '', target: 0 } });
  send({ event: 'setTitle', context, payload: { title: showName ? keyTitle(s.pluginName || r.name || '') : '', target: 0 } });
}

async function press(context) {
  const s = keys.get(context)?.settings || {};
  if (!s.pluginId) return send({ event: 'showAlert', context });
  const r = await api('POST', '/load', { id: s.pluginId, newTrack: Boolean(s.newTrack) });
  if (r.offline) { refresh(context); return send({ event: 'showAlert', context }); }
  send({ event: r.ok ? 'showOk' : 'showAlert', context });
}

// Requests from the property inspector (key settings in the Stream Deck software).
async function fromInspector(msg) {
  const { context, action, payload } = msg;
  const reply = (p) => send({ event: 'sendToPropertyInspector', action, context, payload: p });
  if (payload.event === 'status') {
    const r = await api('GET', '/status');
    reply({ event: 'status', offline: Boolean(r.offline), live: r.live, version: r.version });
  }
  // Filters from the menus: type, source, category, plus the search words.
  const query = () => {
    const f = { q: payload.q || '', type: payload.type || '', source: payload.source || '', category: payload.category || '' };
    return Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  };
  if (payload.event === 'search') {
    const r = await api('GET', `/plugins?${query()}&limit=500`);
    reply({ event: 'results', offline: Boolean(r.offline), plugins: r.plugins || [], total: r.total || 0 });
  }
  if (payload.event === 'facets') {
    const r = await api('GET', `/facets?${query()}`);
    reply({ event: 'facets', offline: Boolean(r.offline), categories: r.categories || [], total: r.total || 0 });
  }
}

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const { event, context, action } = msg;
  if (action && action !== ACTION_LOAD && event !== 'sendToPlugin') return;
  switch (event) {
    case 'willAppear':
      keys.set(context, { action, settings: msg.payload?.settings || {} });
      refresh(context);
      break;
    case 'willDisappear':
      keys.delete(context);
      break;
    case 'didReceiveSettings':
      keys.set(context, { action, settings: msg.payload?.settings || {} });
      refresh(context);
      break;
    case 'keyDown':
      press(context);
      break;
    case 'sendToPlugin':
      fromInspector(msg);
      break;
    default:
  }
});

// Pictures can change (new snapshot, own image) and the Organizer may start later: refresh now and then.
setInterval(() => { for (const c of keys.keys()) refresh(c); }, 30000);
