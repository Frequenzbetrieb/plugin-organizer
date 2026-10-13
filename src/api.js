// Local interface for the Stream Deck plugin (and other local tools).
// Listens on 127.0.0.1 only and requires the key from api.json in the app's data folder,
// so nothing outside this computer – and no web page – can load plugins.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');
const { looseKey, buildIndex } = require('./shotkey');

const PORTS = [47321, 47322, 47323, 47324];
const groupKey = (p) => `${p.name.toLowerCase()}|${p.vendor.toLowerCase()}`;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

// One entry per plugin (formats merged), like the library view, minus hidden ones.
function entries(ctx) {
  const settings = ctx.getSettings();
  const hidden = new Set(settings.hidden || []);
  const map = new Map();
  for (const p of ctx.getLibrary()) {
    if (hidden.has(p.id)) continue;
    const o = settings.categoryOverrides?.[p.id];
    const q = o ? (typeof o === 'string' ? { ...p, category: o, sub: o } : { ...p, ...o }) : p;
    const k = groupKey(q);
    const e = map.get(k);
    if (e) { if (!e.formats.includes(q.format)) e.formats.push(q.format); e.ids.push(q.id); }
    else map.set(k, { ...q, formats: [q.format], ids: [q.id] });
  }
  return [...map.values()];
}

// Picture file of an entry: own image > screenshot (also of format variants) > plugin icon.
function pictureFor(ctx, e) {
  const settings = ctx.getSettings();
  for (const id of e.ids) if (settings.images?.[id]) return settings.images[id];
  const shots = ctx.getShots();
  const direct = shots[groupKey(e)];
  if (direct && direct !== 'failed') return direct;
  if (ctx.looseCache?.shots !== shots || ctx.looseCache.size !== Object.keys(shots).length) {
    ctx.looseCache = { shots, size: Object.keys(shots).length, idx: buildIndex(shots) };
  }
  return ctx.looseCache.idx.get(looseKey(e.name, e.vendor)) || e.icon || null;
}

// Key image: the whole plugin interface, scaled into the upper part of a dark square;
// the strip below stays free for the name the Stream Deck writes as title.
const BG = [0x14, 0x15, 0x1a]; // app background
async function keyImage(ctx, e, size, withTitle = true) {
  let file = pictureFor(ctx, e);
  if (file && file.endsWith('.icns')) file = await ctx.iconPng(file);
  if (!file || !fs.existsSync(file)) return null;
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const areaH = withTitle ? Math.round(size * 0.74) : size;
  const scale = Math.min(size / width, areaH / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const small = img.resize({ width: w, height: h, quality: 'best' }).toBitmap(); // BGRA
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { out[i * 4] = BG[2]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[0]; out[i * 4 + 3] = 255; }
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((areaH - h) / 2);
  for (let y = 0; y < h; y++) small.copy(out, ((y0 + y) * size + x0) * 4, y * w * 4, (y + 1) * w * 4);
  return nativeImage.createFromBitmap(out, { width: size, height: size }).toDataURL();
}

function publicEntry(e) {
  return { id: e.ids[0], name: e.name, vendor: e.vendor, type: e.type, category: e.category, sub: e.sub, source: e.source, formats: e.formats };
}

function start(ctx) {
  const token = ctx.getSettings().apiToken || crypto.randomBytes(24).toString('hex');
  if (!ctx.getSettings().apiToken) ctx.saveSettings({ apiToken: token });

  const server = http.createServer(async (req, res) => {
    // Only local tools with the key; reject browsers (they send an Origin header).
    if (req.headers.origin || req.headers['x-token'] !== token) return json(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/status') {
        return json(res, 200, { ok: true, app: 'Frequenzbetrieb Plugin Organizer', version: ctx.version, live: await ctx.isLiveRunning(), indexing: ctx.isIndexing() });
      }
      if (req.method === 'GET' && url.pathname === '/plugins') {
        const q = (url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
        // Name matches first (starting with the query before containing it), then vendor/category matches.
        const rank = (e) => { const n = e.name.toLowerCase(); const j = q.join(' '); return !q.length ? 0 : n.startsWith(j) ? 0 : n.includes(j) ? 1 : q.every((t) => n.includes(t)) ? 2 : 3; };
        const list = entries(ctx)
          .filter((e) => q.every((t) => `${e.name} ${e.vendor} ${e.category} ${e.sub}`.toLowerCase().includes(t)))
          .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
          .slice(0, Number(url.searchParams.get('limit')) || 200)
          .map(publicEntry);
        return json(res, 200, { plugins: list });
      }
      if (req.method === 'GET' && url.pathname === '/image') {
        const id = url.searchParams.get('id');
        const size = Math.min(288, Math.max(36, Number(url.searchParams.get('size')) || 144));
        const e = entries(ctx).find((x) => x.ids.includes(id));
        if (!e) return json(res, 404, { error: 'unknown plugin' });
        const withTitle = url.searchParams.get('title') !== '0';
        return json(res, 200, { image: await keyImage(ctx, e, size, withTitle), name: e.name });
      }
      if (req.method === 'POST' && url.pathname === '/load') {
        const body = await readBody(req);
        const e = entries(ctx).find((x) => x.ids.includes(body.id));
        if (!e) return json(res, 404, { ok: false, error: 'Plugin nicht gefunden.' });
        const r = await ctx.loadById(e.ids[0], { newTrack: Boolean(body.newTrack) });
        return json(res, r.ok ? 200 : 409, r);
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      ctx.log?.('api-error', err.stack || err.message);
      return json(res, 500, { error: err.message });
    }
  });

  // Take the first free port and tell local tools where we are.
  const tryPort = (i) => {
    if (i >= PORTS.length) { ctx.log?.('api-error', 'kein freier Port'); return; }
    server.once('error', () => tryPort(i + 1));
    server.listen(PORTS[i], '127.0.0.1', () => {
      fs.writeFileSync(path.join(ctx.dataDir(), 'api.json'), JSON.stringify({ port: PORTS[i], token, pid: process.pid }));
    });
  };
  tryPort(0);
  return server;
}

module.exports = { start };
