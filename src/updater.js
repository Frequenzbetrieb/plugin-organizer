// Self-update from GitHub releases. Electron's autoUpdater needs an Apple-signed app; ours is ad-hoc signed,
// so on macOS we download the ZIP, unpack it and swap the app bundle after quitting.
// On Windows the NSIS installer runs silently and starts the app again.
const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

const REPO = 'Frequenzbetrieb/plugin-organizer';
const ASSET = process.platform === 'darwin' ? 'Frequenzbetrieb-Plugin-Organizer-macOS-universal.zip' : 'Frequenzbetrieb-Plugin-Organizer-Windows-x64-Setup.exe';

const newer = (a, b) => {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// → { version, notes, url } when GitHub has a newer release, otherwise null.
async function check() {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  const asset = (rel.assets || []).find((a) => a.name === ASSET);
  if (!version || !asset || !newer(version, app.getVersion())) return null;
  return { version, notes: rel.body || '', url: asset.browser_download_url, size: asset.size };
}

async function download(url, file, onProgress) {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  const reader = res.body.getReader();
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    done += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    onProgress?.(total ? done / total : 0);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

const run = (cmd, args) => new Promise((r, j) => execFile(cmd, args, (e, so, se) => (e ? j(new Error(se || e.message)) : r(so))));

// Downloads the update and replaces the running app; the app quits at the end and restarts itself.
async function install(info, onProgress) {
  if (!app.isPackaged) throw new Error('Nur in der installierten App möglich.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-update-'));
  const file = path.join(dir, ASSET);
  await download(info.url, file, onProgress);

  if (process.platform === 'win32') {
    // --force-run: electron-builder's NSIS installer starts the app again after a silent install.
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return;
  }

  const unpacked = path.join(dir, 'new');
  await run('ditto', ['-x', '-k', file, unpacked]);
  const newApp = fs.readdirSync(unpacked).find((f) => f.endsWith('.app'));
  if (!newApp) throw new Error('Im Update fehlt die App.');
  // …/Name.app/Contents/MacOS/Name → …/Name.app
  const current = path.resolve(process.execPath, '..', '..', '..');
  if (!current.endsWith('.app')) throw new Error('App-Ordner nicht gefunden.');
  try { fs.accessSync(path.dirname(current), fs.constants.W_OK); } catch { throw new Error(`Keine Schreibrechte in ${path.dirname(current)}.`); }
  // Swap after this process has ended, then start the new version.
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, `#!/bin/sh
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
rm -rf ${q(current)}.old
mv ${q(current)} ${q(current)}.old && mv ${q(path.join(unpacked, newApp))} ${q(current)} || mv ${q(current)}.old ${q(current)}
xattr -cr ${q(current)}
rm -rf ${q(current)}.old
open ${q(current)}
rm -rf ${q(dir)}
`);
  spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

module.exports = { check, install, newer };
