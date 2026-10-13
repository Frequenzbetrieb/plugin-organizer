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
// For the list: "ANA 2" and "ANA2" by the same maker are one plugin.
const mergeKey = (p) => `${p.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${p.vendor.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

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
    const k = mergeKey(q);
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
  const loose = ctx.looseCache.idx.get(looseKey(e.name, e.vendor));
  if (loose) return loose;
  // A device preset looks like its device.
  if (e.source === 'Preset' && e.device) return pictureFor(ctx, { ids: [], name: e.device, vendor: 'Ableton' });
  return e.icon || null;
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
      // Filters: type (Effect|Instrument|MIDI FX), source (Plugin|Stock|Max|Preset), category, q (search words).
      // Presets (thousands) only show up when asked for, or when the user put them into a collection/favourites.
      const filtered = () => {
        const type = url.searchParams.get('type');
        const source = url.searchParams.get('source');
        const category = url.searchParams.get('category');
        const collection = url.searchParams.get('collection');
        const favorites = url.searchParams.get('favorites') === '1';
        const q = (url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
        const st = ctx.getSettings();
        const coll = collection && (st.collections || []).find((c) => c.id === collection);
        const favs = new Set(st.favorites || []);
        const list = entries(ctx).filter((e) => (!type || e.type === type) && (source ? e.source === source : e.source !== 'Preset' || coll || favorites)
          && (!coll || e.ids.some((id) => coll.ids.includes(id)))
          && (!favorites || e.ids.some((id) => favs.has(id)))
          && q.every((t) => `${e.name} ${e.vendor} ${e.category} ${e.sub}`.toLowerCase().includes(t)));
        return { list, category, q };
      };
      if (req.method === 'GET' && url.pathname === '/collections') {
        // Own collections and favourites, with plugin counts (for the Stream Deck overview).
        const st = ctx.getSettings();
        const all = entries(ctx);
        const favs = new Set(st.favorites || []);
        const collections = (st.collections || []).map((c) => ({ id: c.id, name: c.name, color: c.color, count: all.filter((e) => e.ids.some((id) => c.ids.includes(id))).length }));
        return json(res, 200, { favorites: all.filter((e) => e.ids.some((id) => favs.has(id))).length, collections });
      }
      if (req.method === 'GET' && url.pathname === '/groupimage') {
        // Sample picture for a group (type/source/category/collection): the first plugin in it that has one.
        const { list: all, category } = filtered();
        const sub = url.searchParams.get('sub');
        const inCat = all.filter((e) => (!category || e.category === category) && (!sub || e.sub === sub));
        const size = Math.min(288, Math.max(36, Number(url.searchParams.get('size')) || 144));
        const withPic = inCat.sort((a, b) => a.name.localeCompare(b.name)).find((e) => { const f = pictureFor(ctx, e); return f && !f.endsWith('.icns'); });
        return json(res, 200, { image: withPic ? await keyImage(ctx, withPic, size, url.searchParams.get('title') !== '0') : null, count: inCat.length });
      }
      if (req.method === 'GET' && url.pathname === '/facets') {
        // Categories (with counts) for the chosen type/source – fills the category menu.
        const { list: all, category } = filtered();
        // by=sub: subcategories within one category (deck browser's intermediate level).
        const bySub = url.searchParams.get('by') === 'sub';
        const list = bySub && category ? all.filter((e) => e.category === category) : all;
        const counts = {};
        for (const e of list) { const k = bySub ? e.sub : e.category; counts[k] = (counts[k] || 0) + 1; }
        const categories = Object.entries(counts).sort((a, b) => (a[0] === 'Unsorted') - (b[0] === 'Unsorted') || a[0].localeCompare(b[0]))
          .map(([name, count]) => ({ name, count }));
        return json(res, 200, { total: list.length, categories });
      }
      if (req.method === 'GET' && url.pathname === '/plugins') {
        const { list: all, category, q } = filtered();
        const sub = url.searchParams.get('sub');
        let inCat = all.filter((e) => (!category || e.category === category) && (!sub || e.sub === sub));
        // variants=0: one key per plugin on the deck – keep stereo (or the plain name), drop "(m)", "(m->s)", "Mono" twins.
        if (url.searchParams.get('variants') === '0') {
          const base = (n) => n.replace(/\s*\((m|s|m->s|mono|stereo|mono\/stereo|\d+->\d+)\)\s*$/i, '').replace(/\s+(mono|stereo)$/i, '').toLowerCase();
          const score = (n) => (/\((s|stereo)\)\s*$|\sstereo$/i.test(n) ? 0 : /\)\s*$|\smono$/i.test(n) ? 2 : 1);
          const best = new Map();
          for (const e of inCat) { const k = `${base(e.name)}|${e.vendor}`; const b = best.get(k); if (!b || score(e.name) < score(b.name)) best.set(k, e); }
          inCat = [...best.values()];
        }
        // Name matches first (starting with the query before containing it), then vendor/category matches.
        const j = q.join(' ');
        const rank = (e) => { const n = e.name.toLowerCase(); return !q.length ? 0 : n.startsWith(j) ? 0 : n.includes(j) ? 1 : q.every((t) => n.includes(t)) ? 2 : 3; };
        const limit = Math.min(3000, Number(url.searchParams.get('limit')) || 500);
        const list = inCat.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit).map(publicEntry);
        return json(res, 200, { total: inCat.length, plugins: list });
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
