// Stream Deck plugin "Frequenzbetrieb Plugin Organizer".
// Speaks the Stream Deck WebSocket protocol directly and talks to the Plugin Organizer through its
// local interface (api.json in the app's data folder: port + key, 127.0.0.1 only).
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ACTION_LOAD = 'de.frequenzbetrieb.pluginorganizer.load';
const ACTION_BROWSE = 'de.frequenzbetrieb.pluginorganizer.browse';
const ACTION_SLOT = 'de.frequenzbetrieb.pluginorganizer.slot';
const ACTION_NAV = 'de.frequenzbetrieb.pluginorganizer.nav';
const BROWSER_PROFILE = 'profiles/Frequenzbetrieb Browser';
const COLS = 4; // content keys per row on the 15-key deck (5th column = navigation)
const PAGE = 12;
const LONG_PRESS_MS = 500;

// ---------- arguments from the Stream Deck software ----------
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^-/, '')] = process.argv[i + 1];

// Key titles in the Stream Deck software's language (German only for "de").
let EN = true;
try { EN = !/^de/i.test(JSON.parse(args.info || '{}').application?.language || ''); } catch { /* English */ }
const T = (de, en) => (EN ? en : de);

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
    send({ event: 'setTitle', context, payload: { title: T('Plugin\nwählen', 'Choose\nplugin'), target: 0 } });
    return;
  }
  const showName = s.showName !== false;
  const r = await api('GET', `/image?id=${encodeURIComponent(s.pluginId)}&size=144&title=${showName ? 1 : 0}`);
  if (r.offline) {
    send({ event: 'setTitle', context, payload: { title: T('Organizer\nstarten', 'Start\nOrganizer'), target: 0 } });
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

// ---------- Browser (profile "Frequenzbetrieb Browser") ----------
// Levels: home (areas, favourites, collections) → categories → plugins. One state per device.
const browsers = new Map(); // device → state
const slots = new Map(); // context → { device, index }
const navs = new Map(); // context → { device, nav }
const imageCache = new Map(); // key → { image, at }

const qs = (params) => Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function cachedImage(key, route) {
  const c = imageCache.get(key);
  if (c && Date.now() - c.at < 120000) return c.image;
  const r = await api('GET', route);
  const image = r.offline ? null : r.image || '';
  if (!r.offline) imageCache.set(key, { image, at: Date.now() });
  return image;
}

function browser(device) {
  if (!browsers.has(device)) browsers.set(device, { level: 'home', page: 0, items: [], path: [] });
  return browsers.get(device);
}

async function loadLevel(device) {
  const b = browser(device);
  if (b.level === 'home') {
    const r = await api('GET', '/collections');
    b.offline = Boolean(r.offline);
    b.items = [
      { kind: 'group', label: T('Effekte', 'Effects'), params: { type: 'Effect' } },
      { kind: 'group', label: T('Instrumente', 'Instruments'), params: { type: 'Instrument' } },
      { kind: 'group', label: 'MIDI FX', params: { type: 'MIDI FX' } },
      { kind: 'group', label: 'Stock', params: { source: 'Stock' } },
      { kind: 'group', label: 'Max', params: { source: 'Max' } },
      { kind: 'group', label: 'Presets', params: { source: 'Preset' } },
      ...(r.favorites ? [{ kind: 'list', label: T('★ Favoriten', '★ Favourites'), params: { favorites: '1' } }] : []),
      ...(r.collections || []).filter((c) => c.count).map((c) => ({ kind: 'list', label: c.name, params: { collection: c.id } })),
    ];
  } else if (b.level === 'categories') {
    const r = await api('GET', `/facets?${qs(b.group.params)}`);
    b.offline = Boolean(r.offline);
    b.items = (r.categories || []).map((c) => ({ kind: 'category', label: c.name, count: c.count, params: { ...b.group.params, category: c.name } }));
  } else if (b.level === 'subs') {
    const r = await api('GET', `/facets?${qs({ ...b.catParams, by: 'sub' })}`);
    b.offline = Boolean(r.offline);
    b.items = [
      { kind: 'list', label: T(`Alle ${b.catParams.category}`, `All ${b.catParams.category}`), count: r.total, params: b.catParams },
      ...(r.categories || []).map((c) => ({ kind: 'list', label: c.name, count: c.count, params: { ...b.catParams, sub: c.name } })),
    ];
  } else {
    const r = await api('GET', `/plugins?${qs(b.listParams)}&variants=0&limit=3000`);
    b.offline = Boolean(r.offline);
    b.items = (r.plugins || []).map((p) => ({ kind: 'plugin', label: p.name, id: p.id }));
  }
}

function pages(b) { return Math.max(1, Math.ceil(b.items.length / PAGE)); }

async function drawSlot(context) {
  const slot = slots.get(context);
  if (!slot) return;
  const b = browser(slot.device);
  const item = b.items[b.page * PAGE + slot.index];
  const set = (image, title) => {
    send({ event: 'setImage', context, payload: { image: image || '', target: 0 } });
    send({ event: 'setTitle', context, payload: { title: title || '', target: 0 } });
  };
  if (b.offline && slot.index === 0) return set('', T('Organizer\nstarten', 'Start\nOrganizer'));
  if (!item) return set('', '');
  if (item.kind === 'plugin') {
    const image = await cachedImage(`p:${item.id}`, `/image?id=${encodeURIComponent(item.id)}&size=144`);
    return set(image, keyTitle(item.label));
  }
  const image = await cachedImage(`g:${qs(item.params)}`, `/groupimage?${qs(item.params)}&size=144`);
  set(image, `${keyTitle(item.label)}${item.count ? ` · ${item.count}` : ''}`);
}

function drawNav(context) {
  const n = navs.get(context);
  if (!n) return;
  const b = browser(n.device);
  const title = n.nav === 'prev' ? (b.page > 0 ? '◀' : '')
    : n.nav === 'next' ? (b.page < pages(b) - 1 ? '▶' : '')
      : (b.level === 'home' ? T('↩\nzurück', '↩\nback') : '↩');
  const sub = n.nav !== 'back' && pages(b) > 1 ? `\n${b.page + 1}/${pages(b)}` : '';
  send({ event: 'setTitle', context, payload: { title: title ? `${title}${sub}` : '', target: 0 } });
}

function drawAll(device) {
  for (const [c, s] of slots) if (s.device === device) drawSlot(c);
  for (const [c, n] of navs) if (n.device === device) drawNav(c);
}

async function go(device, change) {
  const b = browser(device);
  Object.assign(b, change);
  await loadLevel(device);
  drawAll(device);
}

async function pressSlot(context, long) {
  const slot = slots.get(context);
  if (!slot) return;
  const b = browser(slot.device);
  const item = b.items[b.page * PAGE + slot.index];
  if (!item) return;
  if (item.kind === 'plugin') {
    const r = await api('POST', '/load', { id: item.id, newTrack: long });
    return send({ event: r.ok ? 'showOk' : 'showAlert', context });
  }
  b.path.push({ level: b.level, page: b.page, group: b.group, listParams: b.listParams, catParams: b.catParams });
  if (item.kind === 'group') return go(slot.device, { level: 'categories', group: item, page: 0 });
  // Large categories first show their subcategories (Dynamics → Compressor, Limiter, …).
  if (item.kind === 'category' && item.count > PAGE) {
    const r = await api('GET', `/facets?${qs({ ...item.params, by: 'sub' })}`);
    if ((r.categories || []).length > 1) return go(slot.device, { level: 'subs', catParams: item.params, page: 0 });
  }
  return go(slot.device, { level: 'plugins', listParams: item.params, page: 0 });
}

async function pressNav(context) {
  const n = navs.get(context);
  if (!n) return;
  const b = browser(n.device);
  if (n.nav === 'prev' && b.page > 0) { b.page -= 1; return drawAll(n.device); }
  if (n.nav === 'next' && b.page < pages(b) - 1) { b.page += 1; return drawAll(n.device); }
  if (n.nav === 'back') {
    if (!b.path.length) return send({ event: 'switchToProfile', context: args.pluginUUID, device: n.device, payload: {} });
    return go(n.device, { ...b.path.pop() });
  }
}

// "Browser öffnen": reset to the chosen start and switch to the browser profile.
async function openBrowser(context, device) {
  const s = keys.get(context)?.settings || {};
  browsers.set(device, { level: 'home', page: 0, items: [], path: [] });
  const start = s.start || 'home';
  const b = browser(device);
  if (start !== 'home') {
    b.path.push({ level: 'home', page: 0 });
    const groups = { effects: { type: 'Effect' }, instruments: { type: 'Instrument' }, midi: { type: 'MIDI FX' }, stock: { source: 'Stock' }, max: { source: 'Max' }, presets: { source: 'Preset' } };
    if (start === 'favorites') Object.assign(b, { level: 'plugins', listParams: { favorites: '1' } });
    else Object.assign(b, { level: 'categories', group: { params: groups[start] || {} } });
  }
  await loadLevel(device);
  send({ event: 'switchToProfile', context: args.pluginUUID, device, payload: { profile: BROWSER_PROFILE } });
  setTimeout(() => drawAll(device), 300);
}

const pressedAt = new Map(); // context → time of keyDown (long press = new track)

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const { event, context, action, device } = msg;
  if (action === ACTION_SLOT || action === ACTION_NAV) {
    if (event === 'willAppear') {
      const { column, row } = msg.payload.coordinates || {};
      if (action === ACTION_SLOT) { slots.set(context, { device, index: row * COLS + column }); if (!browsers.has(device)) loadLevel(device).then(() => drawAll(device)); else drawSlot(context); }
      else { navs.set(context, { device, nav: msg.payload.settings?.nav || 'back' }); drawNav(context); }
    }
    if (event === 'willDisappear') { slots.delete(context); navs.delete(context); }
    if (event === 'keyDown') pressedAt.set(context, Date.now());
    if (event === 'keyUp') {
      const long = Date.now() - (pressedAt.get(context) || Date.now()) >= LONG_PRESS_MS;
      if (action === ACTION_SLOT) pressSlot(context, long); else pressNav(context);
    }
    return;
  }
  if (action === ACTION_BROWSE) {
    if (event === 'willAppear' || event === 'didReceiveSettings') {
      keys.set(context, { action, settings: msg.payload?.settings || {} });
      send({ event: 'setTitle', context, payload: { title: 'Plugin\nBrowser', target: 0 } });
    }
    if (event === 'keyDown') openBrowser(context, device);
    return;
  }
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
