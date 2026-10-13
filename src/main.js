const { app, BrowserWindow, ipcMain, globalShortcut, protocol, net, dialog, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const scanner = require('./scanner');
const ableton = require('./ableton');
const snapshots = require('./snapshots');
const health = require('./health');
const liveindex = require('./liveindex');
const livedb = require('./livedb');
const api = require('./api');
const updater = require('./updater');
const livescript = require('./livescript');

// Keep the data folder from before the rename, so pictures, mappings and collections stay.
// PO_USERDATA (development): separate data folder, so a dev build can run next to the installed app.
app.setPath('userData', process.env.PO_USERDATA || path.join(app.getPath('appData'), 'Plugin Organizer'));
const dataDir = () => app.getPath('userData');

const LINKS = {
  homepage: 'https://www.frequenzbetrieb.de',
  donate: 'https://www.frequenzbetrieb.de/spenden/',
  github: 'https://github.com/Frequenzbetrieb/plugin-organizer',
  issues: 'https://github.com/Frequenzbetrieb/plugin-organizer/issues',
  streamdeck: 'https://github.com/Frequenzbetrieb/plugin-organizer/releases/latest/download/Frequenzbetrieb-Plugin-Organizer.streamDeckPlugin',
};
const libraryFile = () => path.join(dataDir(), 'library.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const shotsFile = () => path.join(dataDir(), 'shots.json');
const healthFile = () => path.join(dataDir(), 'health.json');

const DEFAULT_SETTINGS = {
  mappings: {}, // key → plugin id
  favorites: [],
  images: {}, // plugin id → custom image path
  hidden: [],
  categoryOverrides: {},
  collections: [], // [{ id, name, color, pinned, ids: [plugin ids] }]
  modifier: 'Control+Alt+Command', // ⌃⌥⌘: nothing in Live uses it
  keyboardLayout: 'full',
  alwaysOnTop: false,
  toggleKey: 'PageUp', // global key that hides/shows the app
  hideAfterLoad: false,
  language: 'auto', // auto | de | en
  autoUpdate: true,
  autoRescan: true,
  remoteEnabled: false, // phone/tablet remote in the local network (off until switched on) // rescan by itself when plugins are installed or removed
  firstSeen: {}, // plugin id → time it first showed up (after the very first scan) – drives the "Neu" badge // look for a new release on GitHub at start and every 6 hours
  windowMode: 'full', // full | sidecar | mini
  fullBounds: null, // size/position of the full window, restored when switching back
  showDawShortcuts: true,
  globalHotkeys: true,
  loadStats: {}, // name|vendor → { count, last }
  sessionFolders: [
    path.join(require('os').homedir(), 'Music'),
    path.join(require('os').homedir(), 'Documents', 'Ableton Live Songs'),
  ].filter((f) => fs.existsSync(f)),
};

let win;
// Send to the main window only while it exists (it may have been closed while work continues).
// UI language: setting, or the system language (German → de, everything else → en).
const lang = () => {
  const l = settings?.language;
  if (l === 'de' || l === 'en') return l;
  return /^de\b/i.test((app.getPreferredSystemLanguages?.() || [app.getLocale()])[0] || '') ? 'de' : 'en';
};
const L = (de, en) => (lang() === 'en' ? en : de);
const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
let library = [];
let settings = { ...DEFAULT_SETTINGS };
let shots = {}; // name|vendor → screenshot path or 'failed'
let snapshotter;
let indexer;
let saveShotsTimer;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// A mapping is a plugin id, or { id, newTrack } when the plugin should go onto a new track.
const mapping = (v) => (typeof v === 'string' ? { id: v, newTrack: false } : v);

// Keys without a modifier only work while Live is the frontmost app, so typing elsewhere stays normal.
let liveFront = false;
function watchFrontApp() {
  if (process.platform !== 'darwin') return;
  const bin = require('./paths').bin('livecapture');
  if (!fs.existsSync(bin)) return;
  const child = require('child_process').spawn(bin, ['watchfront'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    const front = lines.pop();
    if (front === undefined) return;
    const now = front === 'Live';
    if (now !== liveFront) {
      liveFront = now;
      if (!settings.modifier) registerHotkeys();
      send('live-front', liveFront);
    }
  });
  child.on('exit', () => setTimeout(watchFrontApp, 2000));
  app.on('will-quit', () => child.kill());
}

// Hide the app (focus goes back to Live) or bring it to the front.
function toggleWindow(forceShow = false) {
  if (!win) return;
  if (!forceShow && win.isVisible() && win.isFocused()) {
    if (process.platform === 'darwin') app.hide(); else win.minimize();
  } else {
    if (win.isMinimized()) win.restore();
    win.show();
    app.focus({ steal: true });
    win.focus();
  }
}

// Window modes: the full window, a screen-high sidecar strip at the right edge, or a small floating search.
function applyWindowMode(mode, remember = true) {
  if (!win || win.isDestroyed()) return;
  const { screen } = require('electron');
  const display = screen.getDisplayMatching(win.getBounds());
  const area = display.workArea;
  if (settings.windowMode === 'full' && mode !== 'full' && remember) settings.fullBounds = win.getBounds();
  settings.windowMode = mode;
  if (mode === 'sidecar') {
    win.setMinimumSize(300, 400);
    win.setBounds({ x: area.x + area.width - 340, y: area.y, width: 340, height: area.height }, true);
  } else if (mode === 'mini') {
    win.setMinimumSize(300, 200);
    win.setBounds({ x: Math.round(area.x + (area.width - 420) / 2), y: area.y + Math.round(area.height * 0.15), width: 420, height: 480 }, true);
  } else {
    win.setMinimumSize(900, 600);
    const b = settings.fullBounds || { width: 1440, height: 900 };
    win.setBounds({ x: b.x ?? area.x + 40, y: b.y ?? area.y + 40, width: b.width, height: b.height }, true);
  }
  writeJson(settingsFile(), settings);
  send('window-mode', mode);
}

function applyWindowSettings() {
  win?.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
  win?.setVisibleOnAllWorkspaces(Boolean(settings.alwaysOnTop), { visibleOnFullScreen: true });
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (settings.toggleKey) {
    try {
      if (!globalShortcut.register(settings.toggleKey, () => toggleWindow())) logError('toggle-key-register-failed', settings.toggleKey);
    } catch (e) { logError('toggle-key-invalid', `${settings.toggleKey}: ${e.message}`); }
  }
  if (!settings.globalHotkeys) return;
  if (!settings.modifier && !liveFront) return;
  for (const [key, v] of Object.entries(settings.mappings)) {
    const m = mapping(v);
    const accel = settings.modifier ? `${settings.modifier}+${key}` : key;
    try {
      const ok = globalShortcut.register(accel, () => loadById(m.id, { newTrack: m.newTrack }));
      if (!ok) logError('hotkey-register-failed', accel);
    } catch (e) { logError('hotkey-invalid', `${accel}: ${e.message}`); }
  }
}

let loading = false;
let apiCtx = null;
let remote = null;
// Phone remote: runs only while switched on in the settings.
function applyRemote() {
  if (settings.remoteEnabled && !remote && apiCtx) remote = api.startRemote(apiCtx);
  if (!settings.remoteEnabled && remote) { remote.close(); remote = null; }
}
async function loadById(id, opts = {}) {
  if (loading) return { ok: false, error: 'Lädt noch …' };
  loading = true;
  // The app types the search into Live itself; keep hotkeys off meanwhile so those keys can't re-trigger.
  globalShortcut.unregisterAll();
  try {
    return await loadByIdInner(id, opts);
  } finally {
    loading = false;
    registerHotkeys();
  }
}

async function loadByIdInner(id, opts = {}) {
  if (indexer?.running) return { ok: false, error: 'Indexierung läuft – Laden wartet, bis sie fertig ist.' };
  let plugin = library.find((p) => p.id === id);
  if (!plugin) return { ok: false, error: 'Plugin nicht gefunden.' };
  if (!plugin.liveName) {
    const sibling = library.find((p) => p.liveName && p.name === plugin.name && p.vendor === plugin.vendor);
    if (sibling) plugin = { ...plugin, liveName: sibling.liveName };
  }
  try {
    // Preferred: our script inside Live loads through Live's browser API. Fallback: type into Live's search.
    const viaScript = await livescript.load(plugin, opts);
    if (!viaScript?.ok) {
      if (viaScript) logError('script-load', `${plugin.name}: ${viaScript.error}`);
      await liveindex.loadExact(plugin, opts);
    }
    if (settings.hideAfterLoad && win?.isFocused()) app.hide();
    const k = health.groupKey(plugin);
    const st = settings.loadStats[k] || { count: 0 };
    settings.loadStats[k] = { count: st.count + 1, last: Date.now() };
    writeJson(settingsFile(), settings);
    send('loaded', { name: plugin.name });
    return { ok: true };
  } catch (e) {
    const error = e.message.includes('not allowed') || e.message.includes('1002')
      ? 'Bedienungshilfen-Zugriff fehlt (Systemeinstellungen → Datenschutz → Bedienungshilfen).'
      : e.message;
    logError('load-failed', e.stack || e.message);
    send('load-error', { error });
    return { ok: false, error };
  }
}

let scanning = null;
async function rescan() {
  if (scanning) return scanning; // one scan at a time; callers share the result
  scanning = (async () => {
    const before = new Set(library.map((p) => p.id));
    library = livedb.annotate(await scanner.scan((done, total) => send('scan-progress', { done, total }), dataDir()));
    writeJson(libraryFile(), library);
    // Remember what's new since last time (nothing is "new" on the very first scan).
    const added = before.size ? library.filter((p) => !before.has(p.id)) : [];
    const now = Date.now();
    const ids = new Set(library.map((p) => p.id));
    const seen = Object.fromEntries(Object.entries(settings.firstSeen || {}).filter(([id]) => ids.has(id)));
    for (const p of added) seen[p.id] = now;
    settings.firstSeen = seen;
    writeJson(settingsFile(), settings);
    return { added: added.length, removed: [...before].filter((id) => !ids.has(id)).length };
  })();
  try { await scanning; return library; } finally { scanning = null; }
}

// Watches the plugin folders; a quiet rescan runs once installs have settled.
function watchPlugins() {
  let timer;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!settings.autoRescan || loading || indexer?.running) return;
      const n = library.length;
      const ids = new Set(library.map((p) => p.id));
      await rescan();
      const added = library.filter((p) => !ids.has(p.id)).length;
      const removed = n + added - library.length;
      send('library', library);
      if (added || removed) send('rescanned', { added, removed });
    }, 15000);
  };
  for (const d of scanner.watchDirs()) {
    try { fs.watch(d, { recursive: true }, trigger); } catch (e) { logError('watch', `${d}: ${e.message}`); }
  }
}

// ---------- Backup: settings, own pictures and plugin pictures in one archive ----------
// What a backup carries over (window positions and machine-specific things stay behind).
const BACKUP_KEYS = ['mappings', 'favorites', 'images', 'hidden', 'categoryOverrides', 'collections', 'modifier', 'keyboardLayout',
  'alwaysOnTop', 'toggleKey', 'hideAfterLoad', 'windowMode', 'showDawShortcuts', 'globalHotkeys', 'loadStats', 'sessionFolders',
  'autoUpdate', 'autoRescan', 'firstSeen'];
const tar = (args) => new Promise((r, j) => require('child_process').execFile('tar', args, { maxBuffer: 1e8 }, (e, so, se) => (e ? j(new Error(se || e.message)) : r())));

async function exportBackup(target) {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = target ? { filePath: target } : await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${L('Plugin-Organizer-Sicherung', 'Plugin-Organizer-Backup')}-${stamp}.pobackup`), filters: [{ name: L('Plugin-Organizer-Sicherung', 'Plugin Organizer backup'), extensions: ['pobackup'] }] });
  if (r.canceled) return { ok: false };
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'po-backup-'));
  try {
    // Own pictures can live anywhere on disk: copy them in, under a neutral name.
    fs.mkdirSync(path.join(tmp, 'images'));
    const images = {};
    for (const [id, file] of Object.entries(settings.images || {})) {
      if (!fs.existsSync(file)) continue;
      const name = `${Object.keys(images).length}${path.extname(file)}`;
      fs.copyFileSync(file, path.join(tmp, 'images', name));
      images[id] = name;
    }
    const shotsDir = path.join(dataDir(), 'shots');
    // Pictures are stored by file name; only those in our own shots folder travel along.
    const relShots = {};
    for (const [k, v] of Object.entries(shots)) {
      if (v === 'failed' || fs.existsSync(path.join(shotsDir, path.basename(v)))) relShots[k] = v === 'failed' ? v : path.basename(v);
    }
    const data = { app: 'Frequenzbetrieb Plugin Organizer', version: app.getVersion(), created: new Date().toISOString(), platform: process.platform,
      settings: Object.fromEntries(BACKUP_KEYS.filter((k) => k in settings).map((k) => [k, settings[k]])), images, shots: relShots };
    fs.writeFileSync(path.join(tmp, 'backup.json'), JSON.stringify(data));
    const args = ['-cf', r.filePath, '-C', tmp, 'backup.json', 'images'];
    if (fs.existsSync(shotsDir)) args.push('-C', dataDir(), 'shots');
    await tar(args);
    return { ok: true, file: r.filePath, size: fs.statSync(r.filePath).size };
  } catch (e) {
    logError('backup-export', e.stack || e.message);
    return { ok: false, error: e.message };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function importBackup(source) {
  const r = source ? { filePaths: [source] } : await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: L('Plugin-Organizer-Sicherung', 'Plugin Organizer backup'), extensions: ['pobackup'] }] });
  if (r.canceled) return { ok: false };
  const ok = source ? { response: 0 } : await dialog.showMessageBox(win, { type: 'question', buttons: [L('Wiederherstellen', 'Restore'), L('Abbrechen', 'Cancel')], defaultId: 0, cancelId: 1,
    message: L('Sicherung wiederherstellen?', 'Restore backup?'),
    detail: L('Tasten, Favoriten, Sammlungen, Kategorien, eigene Bilder und Einstellungen werden durch die Sicherung ersetzt. Plugin-Bilder aus der Sicherung kommen dazu.',
      'Keys, favourites, collections, categories, own pictures and settings are replaced by the backup. Plugin pictures from the backup are added.') });
  if (ok.response !== 0) return { ok: false };
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'po-restore-'));
  try {
    await tar(['-xf', r.filePaths[0], '-C', tmp]);
    const data = JSON.parse(fs.readFileSync(path.join(tmp, 'backup.json'), 'utf8'));
    if (data.app !== 'Frequenzbetrieb Plugin Organizer') throw new Error('Das ist keine Sicherung des Plugin Organizers.');
    // Plugin pictures: copy over and point to this machine's data folder.
    const shotsDir = path.join(dataDir(), 'shots');
    if (fs.existsSync(path.join(tmp, 'shots'))) fs.cpSync(path.join(tmp, 'shots'), shotsDir, { recursive: true });
    for (const [k, v] of Object.entries(data.shots || {})) {
      if (v === 'failed') { if (!shots[k]) shots[k] = v; } else if (fs.existsSync(path.join(shotsDir, path.basename(v)))) shots[k] = path.join(shotsDir, path.basename(v));
    }
    writeJson(shotsFile(), shots);
    // Own pictures move into the data folder.
    const imgDir = path.join(dataDir(), 'images');
    fs.mkdirSync(imgDir, { recursive: true });
    const images = {};
    for (const [id, name] of Object.entries(data.images || {})) {
      const dest = path.join(imgDir, `${Date.now()}-${name}`);
      fs.copyFileSync(path.join(tmp, 'images', name), dest);
      images[id] = dest;
    }
    settings = { ...settings, ...data.settings, images };
    writeJson(settingsFile(), settings);
    registerHotkeys();
    applyWindowSettings();
    win.reload();
    return { ok: true };
  } catch (e) {
    logError('backup-import', e.stack || e.message);
    return { ok: false, error: e.message };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Small always-on-top window that shows indexing progress, even over Live in full screen.
let monitor;
function updateMonitor(u) {
  if (u.running && !monitor) {
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workArea;
    monitor = new BrowserWindow({
      width: 300, height: 250, x: area.x + area.width - 316, y: area.y + 16,
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
      backgroundColor: '#14151a', webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    monitor.setAlwaysOnTop(true, 'screen-saver');
    monitor.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    monitor.loadFile(path.join(__dirname, 'renderer', 'monitor.html'), { query: { lang: lang() } });
    monitor.on('closed', () => { monitor = null; });
  }
  if (monitor && !monitor.isDestroyed()) monitor.webContents.send('liveindex', u);
  if (u.running === false && monitor) setTimeout(() => { if (monitor && !monitor.isDestroyed()) monitor.close(); }, 4000);
}

function createWindow() {
  win = new BrowserWindow({
    // Wide enough that the filter bar (types, source, formats, view) fits in one row.
    width: Math.min(1440, require('electron').screen.getPrimaryDisplay().workArea.width),
    height: Math.min(900, require('electron').screen.getPrimaryDisplay().workArea.height),
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#14151a',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Closing the main window ends the app: stop a running Live-Index and close its monitor too.
  win.on('closed', () => {
    win = null;
    indexer?.stop();
    if (monitor && !monitor.isDestroyed()) monitor.destroy();
    app.quit();
  });
  // Links (homepage, donations, GitHub) open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  // Dev helper: PO_SCREENSHOT=/path.png writes a screenshot after startup.
  if (process.env.PO_SCREENSHOT) {
    setTimeout(async () => {
      await win.webContents.executeJavaScript(process.env.PO_VIEW === 'health' ? "document.querySelector('#tabHealth').click()" : "document.querySelector('main').scrollTop = 0");
      if (process.env.PO_VIEW === 'health') await new Promise((r) => setTimeout(r, 12000));
      if (process.env.PO_JS) {
        const r = await win.webContents.executeJavaScript(process.env.PO_JS);
        if (process.env.PO_JS_OUT) fs.writeFileSync(process.env.PO_JS_OUT, String(r));
        await new Promise((r2) => setTimeout(r2, 1500));
      }
      if (process.env.PO_SHOWCASE) {
        // Screenshot for the website: effects tab, category overview, from the top.
        await win.webContents.executeJavaScript(`(() => { document.querySelectorAll('#typeTabs button')[1].click();
          setTimeout(() => { document.querySelectorAll('#viewTabs button')[0].click(); if (${process.env.PO_NOKB ? 'true' : 'false'} && !document.querySelector('.keyboard-panel').classList.contains('collapsed')) document.querySelector('#toggleKb').click(); document.querySelector('main').scrollTop = 0; }, 200); })()`);
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (process.env.PO_MODE) {
        await win.webContents.executeJavaScript(`setMode('${process.env.PO_MODE}')`);
        await new Promise((r) => setTimeout(r, 1500));
        if (process.env.PO_CLICKCAT) {
          await win.webContents.executeJavaScript(`document.querySelectorAll('.sv-head')[3]?.click()`);
          await new Promise((r) => setTimeout(r, 800));
        }
        if (process.env.PO_TYPE) {
          await win.webContents.executeJavaScript(`(() => { const s = document.querySelector('#search'); s.value = '${process.env.PO_TYPE}'; s.dispatchEvent(new Event('input')); })()`);
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (process.env.PO_SETTINGS) {
        await win.webContents.executeJavaScript(`document.querySelector('#settingsBtn').click()`);
        await new Promise((r) => setTimeout(r, 500));
      }
      if (process.env.PO_MENU) {
        await win.webContents.executeJavaScript(`document.querySelectorAll('#viewTabs button')[2].click();
          setTimeout(() => { const c = document.querySelectorAll('#grid .card')[1]; const r = c.getBoundingClientRect();
            c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 60, clientY: r.top + 40 })); }, 400);`);
        await new Promise((r) => setTimeout(r, 1500));
        if (process.env.PO_MENU === 'sub') {
          // Real mouse hover: over "Kategorie", then over the third submenu entry.
          const pt = async (sel) => win.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + 30), Math.round(r.top + r.height / 2)]; })()`);
          let [x, y] = await pt('#menu > .has-sub');
          for (let k = 0; k < 3; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: x + k, y }); await new Promise((r) => setTimeout(r, 200)); }
          [x, y] = await pt('#menu > .has-sub > .msubmenu > div:nth-child(2)');
          for (let k = 0; k < 3; k++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: x + k, y }); await new Promise((r) => setTimeout(r, 200)); }
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
      fs.writeFileSync(process.env.PO_SCREENSHOT, (await win.capturePage()).toPNG());
    }, 6000);
  }
}

// Serves local images (plugin icons, custom pictures) to the renderer.
protocol.registerSchemesAsPrivileged([{ scheme: 'pimg', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Write crashes to a log file so they can be diagnosed.
function logError(kind, err) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `${new Date().toISOString()} ${kind}: ${err?.stack || err}\n`);
  } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));
app.on('render-process-gone', (_e, wc, details) => {
  logError('render-process-gone', JSON.stringify(details));
  if (win && wc === win.webContents && details.reason !== 'clean-exit') win.reload();
});
app.on('child-process-gone', (_e, details) => logError('child-process-gone', JSON.stringify(details)));

// Only one instance: a second start just brings the existing window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  protocol.handle('pimg', async (req) => {
    const p = decodeURIComponent(new URL(req.url).searchParams.get('p') || '');
    let file = p;
    if (p.endsWith('.icns')) file = await scanner.iconPng(p, path.join(dataDir(), 'icons'));
    if (!file || !fs.existsSync(file)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  settings = { ...DEFAULT_SETTINGS, ...readJson(settingsFile(), {}) };
  // Older versions defaulted to ⌃⌥, which Live partly uses; move to the free ⌃⌥⌘ once.
  if (!settings.modifierMigrated) {
    if (settings.modifier === 'Control+Alt') settings.modifier = 'Control+Alt+Command';
    settings.modifierMigrated = true;
  }
  library = livedb.annotate(readJson(libraryFile(), []));
  shots = readJson(shotsFile(), {});
  snapshotter = new snapshots.Snapshotter(path.join(dataDir(), 'shots'), shots, (u) => {
    send('snapshots', u);
    clearTimeout(saveShotsTimer);
    saveShotsTimer = setTimeout(() => writeJson(shotsFile(), shots), 1000);
  });

  ipcMain.handle('open-link', (_e, key) => LINKS[key] && shell.openExternal(LINKS[key]));
  ipcMain.handle('get-state', () => ({ lang: lang(), version: app.getVersion(), links: LINKS, library, settings, shots, snapshotsAvailable: snapshots.available(), liveIndexAvailable: liveindex.available(), platform: process.platform, supportedFormats: ableton.SUPPORTED_FORMATS }));
  ipcMain.handle('rescan', rescan);
  ipcMain.handle('backup-export', () => exportBackup());
  ipcMain.handle('remote-info', async () => {
    applyRemote();
    await new Promise((r) => setTimeout(r, 300)); // let the server bind
    const url = remote?.url() || null;
    return { enabled: Boolean(settings.remoteEnabled), url, qr: url ? await require('qrcode').toDataURL(url, { margin: 1, width: 220 }) : null, ip: api.lanAddress() };
  });
  ipcMain.handle('remote-newkey', () => { settings.remoteKey = ''; writeJson(settingsFile(), settings); if (remote) { remote.close(); remote = null; } applyRemote(); return true; });
  // Factory reset: deletes the library, all pictures and settings, then restarts like a fresh install.
  ipcMain.handle('factory-reset', async () => {
    const { response } = process.env.PO_TEST_RESET ? { response: 1 } : await dialog.showMessageBox(win, {
      type: 'warning', buttons: [L('Erst sichern, dann zurücksetzen', 'Back up first, then reset'), L('Ohne Sicherung zurücksetzen', 'Reset without backup'), L('Abbrechen', 'Cancel')], defaultId: 2, cancelId: 2,
      message: L('Auf Werkseinstellungen zurücksetzen?', 'Reset to factory settings?'),
      detail: L('Gelöscht werden: die Plugin-Liste, alle Plugin-Bilder, eigene Bilder, Tasten, Favoriten, Sammlungen, Kategorien und alle Einstellungen. '
        + 'Danach startet der Plugin Organizer neu wie nach der ersten Installation.\n\nDeine Plugins selbst und Ableton Live bleiben unberührt. Das lässt sich nicht rückgängig machen – außer mit einer Sicherung.',
        'This deletes the plugin list, all plugin pictures, own pictures, keys, favourites, collections, categories and all settings. '
        + 'Plugin Organizer then restarts like after the first installation.\n\nYour plugins themselves and Ableton Live are not touched. This cannot be undone – except with a backup.'),
    });
    if (response === 2) return { ok: false };
    if (response === 0) {
      const b = await exportBackup();
      if (!b.ok) return { ok: false, error: b.error || 'Sicherung abgebrochen – nichts gelöscht.' };
    }
    if (loading || indexer?.running) return { ok: false, error: 'Bitte warten, bis Laden/Indexierung fertig ist.' };
    snapshotter.cancel();
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: false });
    for (const f of ['library.json', 'settings.json', 'shots.json', 'health.json', 'preset-tags.json', 'error.log', 'shots', 'images', 'icons']) {
      fs.rmSync(path.join(dataDir(), f), { recursive: true, force: true });
    }
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
  ipcMain.handle('livescript-status', () => livescript.status());
  ipcMain.handle('livescript-install', async () => {
    try { livescript.install(); } catch (e) { logError('livescript-install', e.message); return { ...(await livescript.status()), error: e.message }; }
    return livescript.status();
  });
  ipcMain.handle('backup-import', () => importBackup());
  // Updates: check on demand or automatically; install downloads, swaps the app and restarts.
  let update = null;
  const checkUpdate = async (manual) => {
    try {
      update = await updater.check();
      if (update || manual) send('update', update ? { ...update, manual } : { none: true });
    } catch (e) { if (manual) send('update', { error: e.message }); }
    return update;
  };
  ipcMain.handle('update-check', () => checkUpdate(true));
  // Start with the computer: the system's login items are the truth, not our settings file.
  ipcMain.handle('autostart-get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('autostart-set', (_e, on) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(on) });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('update-install', async () => {
    if (!update) return { ok: false, error: 'Kein Update gefunden.' };
    if (loading || indexer?.running) return { ok: false, error: 'Bitte warten, bis Laden/Indexierung fertig ist.' };
    try {
      await updater.install(update, (f) => send('update-progress', f));
      return { ok: true };
    } catch (e) { logError('update', e.stack || e.message); return { ok: false, error: e.message }; }
  });
  // Dev helper: PO_TEST_UPDATE=1 checks and installs right away.
  // Dev helper: PO_TEST_BACKUP=export:<file> or import:<file>.
  if (process.env.PO_TEST_BACKUP) setTimeout(async () => { const [m, f] = process.env.PO_TEST_BACKUP.split(/:(.*)/); logError('test-backup', JSON.stringify(m === 'export' ? await exportBackup(f) : await importBackup(f))); }, 4000);
  if (process.env.PO_TEST_UPDATE) setTimeout(async () => { if (await checkUpdate(true)) logError('test-update', JSON.stringify(await (async () => { try { await updater.install(update, () => {}); return 'ok'; } catch (e) { return e.message; } })())); else logError('test-update', 'kein Update'); }, 4000);
  if (app.isPackaged) {
    setTimeout(() => settings.autoUpdate && checkUpdate(false), 8000);
    setInterval(() => settings.autoUpdate && checkUpdate(false), 6 * 3600 * 1000);
  }
  ipcMain.handle('save-settings', (_e, next) => {
    settings = { ...settings, ...next };
    writeJson(settingsFile(), settings);
    registerHotkeys();
    applyWindowSettings();
    applyRemote();
    return settings;
  });
  ipcMain.handle('snapshot', (_e, ids, force) => {
    const set = new Set(ids);
    snapshotter.enqueue(library.filter((p) => set.has(p.id)), force);
  });
  indexer = new liveindex.LiveIndexer(path.join(dataDir(), 'shots'), shots, (u) => {
    if (u.error) logError('liveindex-error', u.error);
    send('liveindex', u);
    updateMonitor(u);
    if (u.shot) send('snapshots', { shot: u.shot });
    clearTimeout(saveShotsTimer);
    saveShotsTimer = setTimeout(() => writeJson(shotsFile(), shots), 1000);
  });
  indexer.log = (kind, msg) => logError(kind, msg);
  ipcMain.handle('liveindex-start', async (_e, onlyMissing = true) => {
    if (!liveindex.available()) return { ok: false, error: 'Nur auf macOS verfügbar.' };
    if (!(await ableton.isRunning())) return { ok: false, error: 'Starte zuerst Ableton Live.' };
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Nur Stock & Max', 'Alles ohne Bild', 'Abbrechen'],
      defaultId: 0,
      cancelId: 2,
      message: 'Plugins in Ableton indexieren',
      detail: 'Der Plugin Organizer lädt jedes Plugin ohne Bild nacheinander in Live, fotografiert es und macht das Laden mit ⌘Z wieder rückgängig.\n\n'
        + '• Öffne ein leeres Live-Set und wähle eine leere MIDI-Spur aus.\n'
        + '• In Live muss „Plug-In-Fenster automatisch öffnen“ aktiv sein (Einstellungen → Plug-Ins).\n'
        + '• Fass Maus und Tastatur nicht an, solange es läuft. Stoppen geht jederzeit unten rechts.\n\n'
        + 'macOS fragt beim ersten Mal nach der Berechtigung „Bildschirmaufnahme“.',
    });
    if (response === 2) return { ok: false };
    if (!(await liveindex.requestAccess())) {
      return { ok: false, error: 'Bildschirmaufnahme nicht erlaubt: Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- & Systemaudioaufnahme → Electron aktivieren, dann App neu starten.' };
    }
    indexer.enqueue(response === 0 ? library.filter((p) => p.source === 'Stock' || p.source === 'Max') : library, onlyMissing);
    return { ok: true, total: indexer.total };
  });
  ipcMain.handle('liveindex-stop', () => indexer.stop());
  let captureStop = false;
  ipcMain.handle('capture-all-stop', () => { captureStop = true; snapshotter.cancel(); indexer.stop(); });
  // One switch for everything: rescan → photograph AU/VST3 in our own host → everything still without
  // a picture (VST2, stock, Max, plugins the host couldn't open) through Live.
  ipcMain.handle('capture-all', async () => {
    const live = liveindex.available() && (await ableton.isRunning());
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: [L('Starten', 'Start'), L('Abbrechen', 'Cancel')], defaultId: 0, cancelId: 1,
      message: L('Alle Bilder aufnehmen', 'Take all pictures'),
      detail: L('Der Plugin Organizer sucht zuerst neu nach Plugins, fotografiert dann alle AU- und VST3-Plugins im Hintergrund '
        + 'und lädt anschließend alles, was noch kein Bild hat (VST2, Stock- und Max-Devices), nacheinander in Live.\n\n'
        + (live
          ? '• Öffne in Live ein leeres Set und wähle eine leere MIDI-Spur aus.\n• Lass Live vorne und fass Maus und Tastatur nicht an, sobald Live an der Reihe ist. Stoppen geht jederzeit.\n'
          : !liveindex.available()
            ? '• Unter Windows werden VST3-Plugins fotografiert. Für VST2, Stock und Max gibt es hier noch keine Aufnahme in Live – eigene Bilder gehen per Rechtsklick.\n'
            : '• Ableton Live ist nicht geöffnet: Es werden nur AU- und VST3-Plugins fotografiert. Für VST2, Stock und Max später Live öffnen und erneut starten.\n')
        + '\nBereits vorhandene Bilder bleiben erhalten.',
      'Plugin Organizer first rescans for plugins, then photographs all AU and VST3 plugins in the background '
        + 'and finally loads everything that still has no picture (VST2, stock and Max devices) into Live, one by one.\n\n'
        + (live
          ? '• Open an empty set in Live and select an empty MIDI track.\n• Keep Live in front and don’t touch mouse or keyboard once Live’s turn comes. You can stop at any time.\n'
          : !liveindex.available()
            ? '• On Windows, VST3 plugins are photographed. VST2, stock and Max can’t be captured in Live here yet – set your own picture with a right-click.\n'
            : '• Ableton Live is not open: only AU and VST3 plugins are photographed. For VST2, stock and Max open Live later and start again.\n')
        + '\nExisting pictures are kept.'),
    });
    if (response !== 0) return { ok: false };
    if (live && !(await liveindex.requestAccess())) {
      return { ok: false, error: 'Bildschirmaufnahme nicht erlaubt: Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- & Systemaudioaufnahme → Plugin Organizer aktivieren, dann App neu starten.' };
    }
    captureStop = false;
    (async () => {
      send('capture-all', { phase: 'scan' });
      await rescan();
      send('library', library);
      send('capture-all', { phase: 'host' });
      snapshotter.enqueue(library);
      while (snapshotter.running > 0 || snapshotter.queue.length) await new Promise((r) => setTimeout(r, 1000));
      if (captureStop) { send('capture-all', { phase: 'done', stopped: true }); return; }
      if (live && (await ableton.isRunning())) {
        send('capture-all', { phase: 'live' });
        indexer.enqueue(library, true);
        while (indexer.running) await new Promise((r) => setTimeout(r, 1000));
      }
      send('capture-all', { phase: 'done', live });
    })().catch((e) => { logError('capture-all', e.stack || e.message); send('capture-all', { phase: 'error', error: e.message }); });
    return { ok: true };
  });
  ipcMain.handle('monitor-close', () => { indexer.stop(); if (monitor && !monitor.isDestroyed()) monitor.close(); });
  // Re-record single plugins/devices in Live (stock, Max, VST2) – no dialog, just checks.
  ipcMain.handle('liveindex-some', async (_e, ids) => {
    if (!liveindex.available()) return { error: 'Nur auf macOS verfügbar.' };
    if (!(await ableton.isRunning())) return { error: 'Starte zuerst Ableton Live.' };
    if (indexer.running) return { error: 'Die Indexierung läuft bereits.' };
    if (!(await liveindex.requestAccess())) return { error: 'Bildschirmaufnahme nicht erlaubt (Systemeinstellungen → Datenschutz & Sicherheit).' };
    const set = new Set(ids);
    indexer.enqueue(library.filter((p) => set.has(p.id)), false);
    return { ok: true };
  });
  ipcMain.handle('snapshot-all', () => snapshotter.enqueue(library));
  ipcMain.handle('snapshot-cancel', () => snapshotter.cancel());
  ipcMain.handle('health', async () => {
    const cache = readJson(healthFile(), { sizes: {}, sessions: {} });
    // Racks/presets aren't installed plugins – Health is about plugin files.
    const plugins = library.filter((p) => p.source !== 'Preset');
    await health.measure(plugins, cache.sizes, (done, total) => send('health-progress', { done, total }));
    cache.sessions = health.scanSessions(settings.sessionFolders, cache.sessions);
    writeJson(healthFile(), cache);
    return health.report(plugins, cache.sizes, settings.loadStats, cache.sessions, settings.sessionFolders);
  });
  ipcMain.handle('add-session-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (r.canceled) return settings.sessionFolders;
    settings.sessionFolders = [...new Set([...settings.sessionFolders, r.filePaths[0]])];
    writeJson(settingsFile(), settings);
    return settings.sessionFolders;
  });
  ipcMain.handle('remove-session-folder', (_e, f) => {
    settings.sessionFolders = settings.sessionFolders.filter((x) => x !== f);
    writeJson(settingsFile(), settings);
    return settings.sessionFolders;
  });
  ipcMain.handle('show-in-finder', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('load-plugin', (_e, id, opts) => loadById(id, opts));
  // A chain: load its plugins one after another onto the same track (the first one optionally on a new track).
  ipcMain.handle('load-chain', async (_e, ids, opts = {}) => {
    for (let i = 0; i < ids.length; i++) {
      const r = await loadById(ids[i], { newTrack: i === 0 && Boolean(opts.newTrack) });
      if (!r.ok) return { ok: false, error: r.error, at: i };
      await new Promise((res) => setTimeout(res, 250));
    }
    return { ok: true };
  });
  ipcMain.handle('toggle-window', () => toggleWindow());
  ipcMain.handle('window-mode', (_e, mode) => { applyWindowMode(mode); return settings; });
  ipcMain.handle('daw-status', async () => ({ ableton: await ableton.isRunning() }));
  ipcMain.handle('pick-image', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: L('Bilder', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('check-accessibility', () =>
    process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(true) : true);

  createWindow();
  applyWindowSettings();
  // Local interface for the Stream Deck plugin.
  apiCtx = {
    version: app.getVersion(),
    dataDir,
    getLibrary: () => library,
    getSettings: () => settings,
    getShots: () => shots,
    saveSettings: (patch) => { settings = { ...settings, ...patch }; writeJson(settingsFile(), settings); },
    loadById,
    isLiveRunning: () => ableton.isRunning(),
    isIndexing: () => Boolean(indexer?.running),
    iconPng: (icns) => scanner.iconPng(icns, path.join(dataDir(), 'icons')),
    log: logError,
  };
  api.start(apiCtx);
  applyRemote();
  const area = require('electron').screen.getPrimaryDisplay().workArea;
  if (!settings.widthBumped) {
    settings.widthBumped = true;
    if (settings.fullBounds && settings.fullBounds.width < 1440) settings.fullBounds.width = Math.min(1440, area.width);
    writeJson(settingsFile(), settings);
  }
  if (settings.windowMode && settings.windowMode !== 'full') win.once('ready-to-show', () => applyWindowMode(settings.windowMode, false));
  registerHotkeys();
  watchFrontApp();
  // Dev helper: PO_TEST_LOAD=<plugin id> loads it on a new track after startup.
  if (process.env.PO_TEST_LOAD) setTimeout(() => loadById(process.env.PO_TEST_LOAD, { newTrack: true }).then((r) => logError('test-load', JSON.stringify(r))), 5000);
  // Older caches lack AU component ids, which screenshots need.
  // Rescan once when the scanner learned something new (AU ids, types, MIDI Tools, …).
  const SCANNER_VERSION = 8;
  const stale = library.some((p) => (p.format === 'AU' && !p.au) || !p.type) || settings.scannerVersion !== SCANNER_VERSION;
  if (stale) { settings.scannerVersion = SCANNER_VERSION; writeJson(settingsFile(), settings); }
  if (!library.length || stale) rescan().then(() => win.webContents.send('library', library));
  watchPlugins();
  try { livescript.install(); } catch (e) { logError('livescript-install', e.message); }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
