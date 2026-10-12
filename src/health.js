// Library health: disk usage, Intel-only plugins, VST2 duplicates, unused AAX, and plugins used in Live sets.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const isMac = process.platform === 'darwin';
const groupKey = (p) => `${p.name.toLowerCase()}|${p.vendor.toLowerCase()}`;

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { maxBuffer: 1 << 22 }, (err, out) => resolve(err ? '' : out)));
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  }));
}

async function sizeOf(p) {
  if (isMac) {
    const out = await run('du', ['-sk', p]);
    return (parseInt(out, 10) || 0) * 1024;
  }
  let total = 0;
  const walk = (f) => {
    try {
      const st = fs.statSync(f);
      if (st.isDirectory()) for (const e of fs.readdirSync(f)) walk(path.join(f, e));
      else total += st.size;
    } catch { /* unreadable */ }
  };
  walk(p);
  return total;
}

// Returns the CPU architectures of a bundle's main binary, e.g. ['x86_64', 'arm64'].
async function archsOf(bundle) {
  if (!isMac) return null;
  const dir = path.join(bundle, 'Contents', 'MacOS');
  let exe;
  try { exe = fs.readdirSync(dir).find((f) => !f.startsWith('.')); } catch { return null; }
  if (!exe) return null;
  const out = await run('lipo', ['-archs', path.join(dir, exe)]);
  return out.trim() ? out.trim().split(/\s+/) : null;
}

// Per-bundle facts are cached by path + mtime, so only new or updated plugins are measured again.
async function measure(library, cache, onProgress) {
  const bundles = [...new Set(library.map((p) => p.path))];
  let done = 0;
  await pool(bundles, 8, async (b) => {
    let mtime = 0;
    try { mtime = fs.statSync(b).mtimeMs; } catch { /* gone */ }
    const c = cache[b];
    if (!c || c.mtime !== mtime) cache[b] = { mtime, size: await sizeOf(b), archs: await archsOf(b) };
    onProgress?.(++done, bundles.length);
  });
  for (const b of Object.keys(cache)) if (!bundles.includes(b)) delete cache[b];
  return cache;
}

function proToolsInstalled() {
  if (isMac) return fs.readdirSync('/Applications').some((a) => /^Pro Tools/i.test(a));
  return fs.existsSync('C:\\Program Files\\Avid\\Pro Tools');
}

// ---------- Live sets ----------
function findLiveSets(dir, out = [], depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'Backup' || depth > 8) continue;
      findLiveSets(full, out, depth + 1);
    } else if (e.name.endsWith('.als')) {
      out.push(full);
    }
  }
  return out;
}

// Extracts plugin names from a Live set (.als = gzipped XML).
function pluginsInSet(file) {
  const xml = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const names = new Set();
  const blocks = xml.match(/<(VstPluginInfo|Vst3PluginInfo|AuPluginInfo)[\s\S]*?<\/\1>/g) || [];
  for (let b of blocks) {
    b = b.replace(/<Preset>[\s\S]*?<\/Preset>/g, '');
    const m = b.match(/<PlugName Value="([^"]+)"/) || b.match(/<Name Value="([^"]+)"/);
    if (m) names.add(m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim());
  }
  return [...names];
}

function scanSessions(folders, cache) {
  const sets = folders.flatMap((f) => findLiveSets(f));
  const next = {};
  for (const s of sets) {
    let mtime = 0;
    try { mtime = fs.statSync(s).mtimeMs; } catch { continue; }
    if (cache[s]?.mtime === mtime) { next[s] = cache[s]; continue; }
    try { next[s] = { mtime, plugins: pluginsInSet(s) }; } catch { /* unreadable set */ }
  }
  return next;
}

// ---------- report ----------
function report(library, sizes, stats, sessions, folders) {
  // Live and the plugin bundles spell names differently: "CLA Epic Stereo" vs "CLA Epic (s)", "Serum_x64" vs "Serum".
  const norm = (s) => s.toLowerCase()
    .replace(/[_\s-]*x64\b|[_\s-]*x86\b/g, '')
    .replace(/\((m->s|s|m|mono|stereo)\)|\b(mono\/stereo|stereo|mono)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const p of library) {
    const k = groupKey(p);
    if (!groups.has(k)) groups.set(k, { key: k, name: p.name, vendor: p.vendor, entries: [] });
    groups.get(k).entries.push(p);
  }
  // Shell bundles (WaveShell) host many plugins; count their size once.
  const sumBundles = (plugins) => [...new Set(plugins.map((p) => p.path))].reduce((s, b) => s + (sizes[b]?.size || 0), 0);
  // A shell bundle's size is split across the plugins inside it.
  const sharers = {};
  for (const p of library) sharers[p.path] = (sharers[p.path] || 0) + 1;
  const shareSize = (plugins) => plugins.reduce((s, p) => s + (sizes[p.path]?.size || 0) / sharers[p.path], 0);
  const item = (g, plugins) => ({ key: g.key, name: g.name, vendor: g.vendor, size: shareSize(plugins), paths: [...new Set(plugins.map((p) => p.path))], formats: [...new Set(plugins.map((p) => p.format))] });

  const total = sumBundles(library);

  const intelOnly = [];
  const vst2Copies = [];
  const neverLoaded = [];
  const aax = [];
  const ptInstalled = proToolsInstalled();

  for (const g of groups.values()) {
    const intel = g.entries.filter((p) => { const a = sizes[p.path]?.archs; return a && !a.includes('arm64'); });
    const native = g.entries.some((p) => sizes[p.path]?.archs?.includes('arm64'));
    if (process.arch === 'arm64' && intel.length && !native) intelOnly.push(item(g, intel));
    const hasVst3 = g.entries.some((p) => p.format === 'VST3');
    const vst2 = g.entries.filter((p) => p.format === 'VST');
    if (hasVst3 && vst2.length) vst2Copies.push(item(g, vst2));
    if (!stats[g.key]) neverLoaded.push(item(g, g.entries));
    const ax = g.entries.filter((p) => p.format === 'AAX');
    if (!ptInstalled && ax.length) aax.push(item(g, ax));
  }

  // Sessions: what's used, what's missing on this Mac.
  const used = new Map(); // normalized name → { name, sets }
  for (const [file, s] of Object.entries(sessions)) {
    for (const n of s.plugins) {
      const k = norm(n);
      if (!used.has(k)) used.set(k, { name: n, sets: [] });
      used.get(k).sets.push(path.basename(file, '.als'));
    }
  }
  const installed = new Set(library.map((p) => norm(p.name)));
  const missing = [...used.entries()].filter(([k]) => !installed.has(k)).map(([, v]) => v);
  const usedInSets = new Set(used.keys());
  const neverInSets = Object.keys(sessions).length
    ? [...groups.values()].filter((g) => !usedInSets.has(norm(g.name))).map((g) => item(g, g.entries))
    : [];

  const bySize = (a, b) => b.size - a.size;
  const sum = (list) => list.reduce((s, i) => s + i.size, 0);
  // Reclaimable: VST2 copies + unused AAX + Intel-only (counted once per bundle).
  const reclaimPaths = new Set([...vst2Copies, ...aax, ...intelOnly].flatMap((i) => i.paths));
  const reclaimable = [...reclaimPaths].reduce((s, b) => s + (sizes[b]?.size || 0), 0);

  return {
    total,
    reclaimable,
    proToolsInstalled: ptInstalled,
    intelOnly: { size: sum(intelOnly), items: intelOnly.sort(bySize) },
    vst2Copies: { size: sum(vst2Copies), items: vst2Copies.sort(bySize) },
    neverLoaded: { size: sum(neverLoaded), items: neverLoaded.sort(bySize) },
    aax: { size: sum(aax), items: aax.sort(bySize) },
    sessions: {
      folders,
      setCount: Object.keys(sessions).length,
      usedCount: used.size,
      missing: missing.sort((a, b) => b.sets.length - a.sets.length),
      neverUsed: { size: sum(neverInSets), items: neverInSets.sort(bySize) },
      topUsed: [...used.values()].sort((a, b) => b.sets.length - a.sets.length).slice(0, 30),
    },
  };
}

module.exports = { measure, scanSessions, report, groupKey };
