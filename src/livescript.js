// Talks to our control surface script inside Live (src/live-script/Frequenzbetrieb, UDP 127.0.0.1:47330).
// With the script active, loading goes through Live's browser API – fast, exact, also on Windows.
// Without it, the app falls back to typing into Live's search (liveindex.loadExact).
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 47330;
const NAME = 'Frequenzbetrieb';
const SRC = path.join(__dirname, 'live-script', NAME);
const isMac = process.platform === 'darwin';

// The User Library Live uses: <UserLibrary><ProjectPath>/<ProjectName> from the newest Library.cfg.
function userLibrary() {
  const prefs = isMac ? path.join(os.homedir(), 'Library', 'Preferences', 'Ableton') : path.join(process.env.APPDATA || '', 'Ableton');
  try {
    const versions = fs.readdirSync(prefs).filter((d) => /^Live \d/.test(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const cfg = fs.readFileSync(path.join(prefs, versions.pop(), isMac ? 'Library.cfg' : path.join('Preferences', 'Library.cfg')), 'utf8');
    const block = cfg.match(/<UserLibrary>[\s\S]*?<\/UserLibrary>/)?.[0] || '';
    const dir = block.match(/<ProjectPath Value="([^"]*)"/)?.[1];
    const name = block.match(/<ProjectName Value="([^"]*)"/)?.[1] || 'User Library';
    if (dir && fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  } catch { /* no Live prefs */ }
  const fallback = isMac ? path.join(os.homedir(), 'Music', 'Ableton', 'User Library') : path.join(os.homedir(), 'Documents', 'Ableton', 'User Library');
  return fs.existsSync(fallback) ? fallback : null;
}

const versionOf = (file) => { try { return Number(fs.readFileSync(file, 'utf8').match(/^VERSION = (\d+)/m)?.[1] || 0); } catch { return -1; } };

// Copies the script into the User Library when it's missing or older – never over a newer one
// (e.g. after going back to an older app version). → target folder or null.
function install() {
  const lib = userLibrary();
  if (!lib) return null;
  const dest = path.join(lib, 'Remote Scripts', NAME);
  if (versionOf(path.join(dest, 'organizer.py')) > VERSION) return dest;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(SRC)) {
    const data = fs.readFileSync(path.join(SRC, f));
    const target = path.join(dest, f);
    let same = false;
    try { same = fs.readFileSync(target).equals(data); } catch { /* new */ }
    if (!same) fs.writeFileSync(target, data);
  }
  return dest;
}

let seq = 0;
function request(msg, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const id = ++seq;
    const done = (r) => { clearTimeout(t); try { sock.close(); } catch { /* closed */ } resolve(r); };
    const t = setTimeout(() => done(null), timeout);
    sock.on('message', (buf) => { try { const r = JSON.parse(buf.toString()); if (r.id === id) done(r); } catch { /* ignore */ } });
    sock.on('error', () => done(null));
    sock.send(JSON.stringify({ ...msg, id }), PORT, '127.0.0.1');
  });
}

// Version of the script we ship; Live only picks up a newer one after a restart.
const VERSION = Number(fs.readFileSync(path.join(SRC, 'organizer.py'), 'utf8').match(/^VERSION = (\d+)/m)?.[1] || 0);

// Version running in Live (0 = script not active).
async function running() {
  const r = await request({ cmd: 'ping' }, 600);
  return r?.ok ? r.version || 1 : 0;
}
// true when Live runs with our script selected as control surface.
const active = async () => (await running()) > 0;
// true when Live runs our current script (needed for the Live-Index's remember/unload).
const current = async () => (await running()) >= VERSION;

// → { ok } | { ok:false, error:'notfound'|… } | null (script not reachable)
function load(plugin, opts = {}) {
  const newTrack = opts.newTrack ? (plugin.type === 'Effect' ? 'audio' : 'midi') : '';
  const base = { cmd: 'load', newTrack, type: plugin.type, remember: Boolean(opts.remember) };
  if (plugin.source === 'Stock') return request({ ...base, kind: 'stock', name: plugin.name }, 8000);
  if (plugin.source === 'Max' || plugin.source === 'Preset') return request({ ...base, kind: 'file', path: plugin.path }, 8000);
  // The first plugin lookup walks Live's whole plugin list – give it time.
  return request({ ...base, kind: 'plugin', name: plugin.liveName || plugin.name, format: plugin.format }, 15000);
}

// Installed (files up to date in the User Library) and active (Live answers)?
async function status() {
  const lib = userLibrary();
  const dest = lib && path.join(lib, 'Remote Scripts', NAME);
  // Installed = our version (or a newer one) is in the User Library.
  const installed = Boolean(dest) && versionOf(path.join(dest, 'organizer.py')) >= VERSION;
  const v = await running();
  return { installed, active: v > 0, outdated: v > 0 && v < VERSION, folder: dest || null };
}

module.exports = { install, active, current, status, load, userLibrary, request };
