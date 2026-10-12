// Reads Live's own plugin database to learn the names Live shows in its browser
// (e.g. the file "ANA2.vst" appears in Live as "ANA 2").
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function dbFile() {
  const dir = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Ableton', 'Live Database')
    : path.join(process.env.LOCALAPPDATA || '', 'Ableton', 'Live Database');
  try {
    const files = fs.readdirSync(dir).filter((f) => /^Live-plugins-\d+\.db$/.test(f))
      .map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files[0] || null;
  } catch { return null; }
}

// Map: plugin bundle path → name in Live.
function liveNames() {
  const db = dbFile();
  const map = new Map();
  if (!db) return map;
  try {
    const out = execFileSync('sqlite3', ['-readonly', '-separator', '\t', db,
      'select m.path, p.name from plugins p join plugin_modules m on m.module_id = p.module_id where p.enabled = 1;'],
    { maxBuffer: 16 << 20 }).toString();
    for (const line of out.split('\n')) {
      const [p, name] = line.split('\t');
      if (p && name && !map.has(p)) map.set(p, name);
    }
  } catch { /* sqlite3 missing or db locked */ }
  return map;
}

// Adds `liveName` to VST/VST3 entries Live knows under a different name.
function annotate(library) {
  const names = liveNames();
  for (const p of library) {
    const n = names.get(p.path);
    if (n && n !== p.name) p.liveName = n;
    else delete p.liveName;
  }
  return library;
}

module.exports = { annotate };
