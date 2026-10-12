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

// Keep the data folder from before the rename, so pictures, mappings and collections stay.
app.setPath('userData', path.join(app.getPath('appData'), 'Plugin Organizer'));
const dataDir = () => app.getPath('userData');

const LINKS = {
  homepage: 'https://www.frequenzbetrieb.de',
  donate: 'https://www.frequenzbetrieb.de/spenden/',
  github: 'https://github.com/Frequenzbetrieb/plugin-organizer',
  issues: 'https://github.com/Frequenzbetrieb/plugin-organizer/issues',
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
  showDawShortcuts: true,
  globalHotkeys: true,
  loadStats: {}, // name|vendor → { count, last }
  sessionFolders: [
    path.join(require('os').homedir(), 'Music'),
    path.join(require('os').homedir(), 'Documents', 'Ableton Live Songs'),
  ].filter((f) => fs.existsSync(f)),
};

let win;
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
      win?.webContents.send('live-front', liveFront);
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
    await liveindex.loadExact(plugin, opts);
    if (settings.hideAfterLoad && win?.isFocused()) app.hide();
    const k = health.groupKey(plugin);
    const st = settings.loadStats[k] || { count: 0 };
    settings.loadStats[k] = { count: st.count + 1, last: Date.now() };
    writeJson(settingsFile(), settings);
    win?.webContents.send('loaded', { name: plugin.name });
    return { ok: true };
  } catch (e) {
    const error = e.message.includes('not allowed') || e.message.includes('1002')
      ? 'Bedienungshilfen-Zugriff fehlt (Systemeinstellungen → Datenschutz → Bedienungshilfen).'
      : e.message;
    logError('load-failed', e.stack || e.message);
    win?.webContents.send('load-error', { error });
    return { ok: false, error };
  }
}

async function rescan() {
  library = livedb.annotate(await scanner.scan((done, total) => win?.webContents.send('scan-progress', { done, total })));
  writeJson(libraryFile(), library);
  return library;
}

// Small always-on-top window that shows indexing progress, even over Live in full screen.
let monitor;
function updateMonitor(u) {
  if (u.running && !monitor) {
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workArea;
    monitor = new BrowserWindow({
      width: 300, height: 250, x: area.x + area.width - 316, y: area.y + 16,
      frame: false, resizable: false, alwaysOnTop: true, focusable: false, skipTaskbar: true,
      backgroundColor: '#14151a', webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    monitor.setAlwaysOnTop(true, 'screen-saver');
    monitor.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    monitor.loadFile(path.join(__dirname, 'renderer', 'monitor.html'));
    monitor.on('closed', () => { monitor = null; });
  }
  if (monitor) monitor.webContents.send('liveindex', u);
  if (u.running === false && monitor) setTimeout(() => monitor?.close(), 4000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#14151a',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Links (homepage, donations, GitHub) open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  // Dev helper: PO_SCREENSHOT=/path.png writes a screenshot after startup.
  if (process.env.PO_SCREENSHOT) {
    setTimeout(async () => {
      await win.webContents.executeJavaScript(process.env.PO_VIEW === 'health' ? "document.querySelector('#tabHealth').click()" : "document.querySelector('main').scrollTop = 0");
      if (process.env.PO_VIEW === 'health') await new Promise((r) => setTimeout(r, 12000));
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
    if (!win) return;
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
    win?.webContents.send('snapshots', u);
    clearTimeout(saveShotsTimer);
    saveShotsTimer = setTimeout(() => writeJson(shotsFile(), shots), 1000);
  });

  ipcMain.handle('open-link', (_e, key) => LINKS[key] && shell.openExternal(LINKS[key]));
  ipcMain.handle('get-state', () => ({ version: app.getVersion(), links: LINKS, library, settings, shots, snapshotsAvailable: snapshots.available(), liveIndexAvailable: liveindex.available(), platform: process.platform, supportedFormats: ableton.SUPPORTED_FORMATS }));
  ipcMain.handle('rescan', rescan);
  ipcMain.handle('save-settings', (_e, next) => {
    settings = { ...settings, ...next };
    writeJson(settingsFile(), settings);
    registerHotkeys();
    applyWindowSettings();
    return settings;
  });
  ipcMain.handle('snapshot', (_e, ids, force) => {
    const set = new Set(ids);
    snapshotter.enqueue(library.filter((p) => set.has(p.id)), force);
  });
  indexer = new liveindex.LiveIndexer(path.join(dataDir(), 'shots'), shots, (u) => {
    if (u.error) logError('liveindex-error', u.error);
    win?.webContents.send('liveindex', u);
    updateMonitor(u);
    if (u.shot) win?.webContents.send('snapshots', { shot: u.shot });
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
    await health.measure(library, cache.sizes, (done, total) => win?.webContents.send('health-progress', { done, total }));
    cache.sessions = health.scanSessions(settings.sessionFolders, cache.sessions);
    writeJson(healthFile(), cache);
    return health.report(library, cache.sizes, settings.loadStats, cache.sessions, settings.sessionFolders);
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
  ipcMain.handle('toggle-window', () => toggleWindow());
  ipcMain.handle('daw-status', async () => ({ ableton: await ableton.isRunning() }));
  ipcMain.handle('pick-image', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('check-accessibility', () =>
    process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(true) : true);

  createWindow();
  applyWindowSettings();
  registerHotkeys();
  watchFrontApp();
  // Dev helper: PO_TEST_LOAD=<plugin id> loads it on a new track after startup.
  if (process.env.PO_TEST_LOAD) setTimeout(() => loadById(process.env.PO_TEST_LOAD, { newTrack: true }).then((r) => logError('test-load', JSON.stringify(r))), 5000);
  // Older caches lack AU component ids, which screenshots need.
  const stale = library.some((p) => (p.format === 'AU' && !p.au) || !p.type);
  if (!library.length || stale) rescan().then(() => win.webContents.send('library', library));
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
