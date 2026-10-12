// "Index in Ableton": loads each plugin/device into Live, photographs it, then undoes the load.
// Covers what the standalone hosts can't open: VST2 plugins, Live's stock devices and Max for Live devices.
const { execFile } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ableton = require('./ableton');
const { hasPicture } = require('./snapshots');

const BIN = require('./paths').bin('livecapture');
const groupKey = (p) => `${p.name.toLowerCase()}|${p.vendor.toLowerCase()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function helper(args) {
  return new Promise((resolve) => {
    execFile(BIN, args, { maxBuffer: 1 << 20 }, (err, out) => {
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

const available = () => process.platform === 'darwin' && fs.existsSync(BIN);
const requestAccess = async () => (await helper(['access']))?.granted === true;
const windows = async () => (await helper(['windows'])) || [];

function shrink(file) {
  return new Promise((resolve) => execFile('sips', ['--resampleWidthMax', '720', file], () => resolve()));
}

async function frontTitle() {
  return new Promise((resolve) => execFile('osascript', ['-e',
    'tell application "System Events" to tell process "Live" to get name of front window'], (err, out) => resolve(err ? '' : out.trim())));
}
// Live can have a second window (e.g. Arrangement) with the same title. The right one is the window whose
// browser shows the search results – so look for the entry in every large Live window, last hit first.
async function findInResults(loader, query, tmp, deadline) {
  for (;;) {
    const wins = (await windows()).filter((w) => w.w > 500 && w.h > 300 && !w.title.includes('/'));
    wins.sort((a, b) => (b.id === loader.browserWin) - (a.id === loader.browserWin) || b.w * b.h - a.w * a.h);
    for (const w of wins) {
      const index = await loader.resultIndex(w, query, tmp);
      if (index >= 0) { loader.browserWin = w.id; return { main: w, index }; }
    }
    if (Date.now() > deadline) return { main: null, index: -1 };
    await sleep(150);
  }
}


class LiveIndexer {
  constructor(dir, store, onUpdate) {
    this.dir = dir;
    this.store = store; // shared with the snapshotter: { [groupKey]: path | 'failed' }
    this.onUpdate = onUpdate;
    this.queue = [];
    this.running = false;
    this.done = 0;
    this.total = 0;
  }

  // Picks one entry per name+vendor that Live can load, for every group still without a picture.
  enqueue(library, onlyMissing = true) {
    const groups = new Map();
    for (const p of library) {
      if (!ableton.SUPPORTED_FORMATS.includes(p.format)) continue;
      if (p.midiTool) continue; // MIDI Tools live in the clip view – nothing to photograph on the track
      const k = groupKey(p);
      if (onlyMissing && hasPicture(this.store, p)) continue;
      if (!groups.has(k)) groups.set(k, p);
    }
    // Most useful first: stock devices, then Max devices from Ableton packs, own User Library devices last.
    const rank = (p) => (p.source === 'Stock' ? 0 : p.source === 'Max' && p.vendor === 'User Library' ? 3 : p.source === 'Max' ? 1 : 2);
    this.queue = [...groups.values()].sort((a, b) => rank(a) - rank(b)).map((p) => ({ key: groupKey(p), plugin: p }));
    this.done = 0;
    this.total = this.queue.length;
    if (!this.running) this.loop();
  }

  stop() { this.stopReason = 'Stopp gedrückt'; this.queue = []; }

  progress(current) {
    this.onUpdate({ running: this.running && (this.queue.length > 0 || Boolean(current)), done: this.done, total: this.total, current });
  }

  async loop() {
    this.running = true;
    this.main = null;
    this.stopReason = '';
    this.log?.('liveindex-start', `${this.queue.length} Einträge`);
    while (this.queue.length) {
      const job = this.queue.shift();
      this.progress(job.plugin.name);
      if (!(await ableton.isRunning())) { this.stopReason = 'Live läuft nicht mehr'; this.queue = []; this.onUpdate({ error: 'Ableton Live läuft nicht mehr – Indexierung gestoppt.' }); break; }
      let ok = false;
      try { ok = await this.capture(job); } catch { ok = false; }
      if (this.lastUndo && this.lastUndo.startsWith('skipped') && this.lastLoaded) {
        this.stopReason = `nicht entfernbar: ${job.plugin.name} (${this.lastUndo})`;
        this.queue = [];
        this.onUpdate({ error: `Gestoppt: „${job.plugin.name}“ ließ sich nicht wieder entfernen (${this.lastUndo.slice(9)}). Bitte in Live von der Spur löschen und neu starten.` });
      }
      if (!ok && this.store[job.key] !== undefined && this.store[job.key] !== 'failed') ok = true;
      if (!ok) this.store[job.key] = 'failed';
      this.done++;
      this.onUpdate({ shot: { key: job.key, path: this.store[job.key], name: job.plugin.name } });
    }
    this.running = false;
    this.log?.('liveindex-end', `${this.done}/${this.total}${this.stopReason ? ` – abgebrochen: ${this.stopReason}` : ''}`);
    this.progress();
  }

  async capture(job) {
    fs.mkdirSync(this.dir, { recursive: true });
    const p = job.plugin;
    const isDevice = p.source === 'Stock' || p.source === 'Max';
    this.hadPluginWindow = false;
    const hash = crypto.createHash('md5').update(job.key).digest('hex');
    const out = path.join(this.dir, `${hash}-${Date.now()}.png`);
    const tmpA = path.join(this.dir, `.before-${hash}.png`);
    const tmpB = path.join(this.dir, `.after-${hash}.png`);

    const before = await windows();

    // Search, then find the exact entry in the result list by reading it (generic names like "Reverb"
    // otherwise load "Convolution Reverb", which Live lists first).
    const query = p.liveName || p.name;
    await ableton.search(query);
    // Poll the result list until the entry shows up (usually well under a second).
    let index = -1;
    let main = null;
    // Live can be slow to show results (or miss the typing while busy): wait up to 4 s, then type once more.
    for (let attempt = 0; attempt < 2 && index < 0; attempt++) {
      if (attempt > 0) await ableton.search(query);
      await sleep(attempt ? 600 : 200);
      ({ main, index } = await findInResults(this, query, tmpB, Date.now() + 4000));
    }
    // "Before" picture of the window with the browser and device view (the search doesn't touch the device view).
    if (main) await helper(['capture', String(main.id), tmpA]);
    if (index < 0) {
      this.lastUndo = 'not in results';
      fs.mkdirSync(path.join(this.dir, 'debug'), { recursive: true });
      const safe = p.name.replace(/[^\w.-]+/g, '_');
      fs.writeFile(path.join(this.dir, 'debug', `${safe}-box.json`), JSON.stringify({ notFound: true, query }), () => {});
      fs.rename(tmpB, path.join(this.dir, 'debug', `${safe}-notfound.png`), () => {});
      this.log?.('liveindex-notfound', query);
      return false;
    }
    // Read the undo state only now: Live refreshes the entry ~1 s after the previous item's undo.
    const since = Date.now() - (this.lastUndoAt || 0);
    if (since < 1200) await sleep(1200 - since);
    const undoBefore = (await helper(['undolabel']))?.label ?? '';
    await this.pickVerified(main, index, tmpB);
    this.lastLoaded = false;
    let ok = false;

    if (!isDevice) {
      // Wait for the plugin window Live opens automatically.
      const known = new Set(before.map((w) => w.id));
      let win = null;
      for (let t = 0; t < 30 && !win; t++) {
        await sleep(150);
        win = (await windows()).find((w) => !known.has(w.id) && w.w > 80 && w.h > 60);
      }
      this.hadPluginWindow = Boolean(win);
      if (win) {
        await sleep(1200); // let the editor draw
        ok = (await helper(['capture', String(win.id), out]))?.ok === true;
      }
    }

    // Locate the new device in the device view. Max devices draw their interface late, so poll until it shows up.
    let box = null;
    this.lastUndo = '';
    const deadline = Date.now() + (p.source === 'Max' ? 12000 : isDevice ? 5000 : 1000);
    await sleep(isDevice ? 250 : 0);
    do {
      if ((await helper(['capture', String(main.id), tmpB]))?.ok) {
        const r = await helper(['diffbox', tmpA, tmpB]);
        if (r?.ok) box = r;
      }
      if (!box) await sleep(200);
    } while (!box && Date.now() < deadline);
    this.lastLoaded = Boolean(box);
    if (box && p.source === 'Max') {
      // Max devices keep drawing for a moment; take the final picture a bit later.
      await sleep(900);
      if ((await helper(['capture', String(main.id), tmpB]))?.ok) {
        const r = await helper(['diffbox', tmpA, tmpB]);
        if (r?.ok) box = r;
      }
    }
    if (isDevice && box) {
      ok = (await helper(['crop', tmpB, String(box.x), String(box.y), String(box.w), String(box.h), out]))?.ok === true;
    }

    await this.remove(undoBefore, p.source !== 'Max');
    // Keep before/after images for diagnosis, but only when something went wrong.
    if (ok && !this.lastUndo.startsWith('skipped')) {
      fs.rm(tmpA, () => {});
      fs.rm(tmpB, () => {});
    } else {
    const dbg = path.join(this.dir, 'debug');
    fs.mkdirSync(dbg, { recursive: true });
    const safe = p.name.replace(/[^\w.-]+/g, '_');
    fs.rename(tmpA, path.join(dbg, `${safe}-1-before.png`), () => {});
    fs.rename(tmpB, path.join(dbg, `${safe}-2-after.png`), () => {});
    fs.writeFile(path.join(dbg, `${safe}-box.json`), JSON.stringify({ box, main, ok, undo: this.lastUndo }), () => {});
    }
    if (!ok) return false;
    await shrink(out);
    const old = this.store[job.key];
    if (old && old !== 'failed' && old !== out) fs.rm(old, () => {});
    this.store[job.key] = out;
    return true;
  }

  // Position of `name` in Live's search results, read from a screenshot of the browser (-1 = not found).
  async resultIndex(main, name, tmp) {
    if (!(await helper(['capture', String(main.id), tmp]))?.ok) return -1;
    const lines = (await helper(['ocr', tmp, '0.3'])) || [];
    const header = lines.find((l) => /^(Name)$/.test(l.text.trim()));
    if (!header) return -1;
    const footer = lines.find((l) => /^Tags:?$/.test(l.text.trim()) && l.y > header.y);
    const rows = lines
      .filter((l) => l.y > header.y + 4 && (!footer || l.y < footer.y - 4) && Math.abs(l.x - header.x) < 80)
      .sort((a, b) => a.y - b.y);
    if (!rows.length) return -1;
    // Row height: smallest typical gap between rows.
    const gaps = rows.slice(1).map((r, i) => r.y - rows[i].y).filter((g) => g > 5).sort((a, b) => a - b);
    const rowH = gaps.length ? gaps[Math.floor(gaps.length / 4)] : 19;
    // Compare letters and digits only: OCR reads "_" as space, drops dots, etc.
    // I, l, 1 and | look alike to OCR ("Granulator II" is read as "Granulator Il").
    const norm = (t) => t.toLowerCase().replace(/\.(amxd|adv|adg)$/, '').replace(/[l1|!]/g, 'i').replace(/[^a-z0-9äöüß]/g, '');
    const want = norm(name);
    // OCR puts the row's little icon in front of the text ("AU", "E", "2"…); allow up to 3 junk characters.
    const hit = rows.find((r) => { const t = norm(r.text); return t === want || (t.endsWith(want) && t.length - want.length <= 3); });
    if (!hit) return -1;
    this.lastHit = { y: hit.y + hit.h / 2, rowH, x0: header.x, x1: header.x + 260 };
    return Math.round((hit.y - rows[0].y) / rowH);
  }

  // Moves Live's browser selection onto the row found by resultIndex and loads it.
  // Live jumps to the previously used item when it is in the list, so look where the selection really is.
  async pickVerified(main, index, tmp) {
    const target = this.lastHit;
    await ableton.arrows(1);
    if (!target) { await ableton.arrows(index, true); return; }
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(120);
      if (!(await helper(['capture', String(main.id), tmp]))?.ok) break;
      const hl = await helper(['highlight', tmp, String(Math.round(target.x0)), String(Math.round(target.x1))]);
      if (!hl?.ok) break;
      const delta = Math.round((target.y - hl.y) / target.rowH);
      if (delta === 0) { await ableton.arrows(0, true); return; }
      await ableton.arrows(delta);
    }
    // Fallback: count from the top.
    await ableton.arrows(index, true);
  }

  // Removes the device we just loaded again (undo via Live's Edit menu).
  async remove(before, quick) {
    if (this.hadPluginWindow) { await ableton.closePluginWindows(); await sleep(150); }
    const r = await helper(['undo', before || '', quick ? 'quick' : 'full']);
    this.lastUndo = r?.result || 'skipped: helper failed';
    this.lastUndoAt = Date.now();
    await sleep(300); // let Live redraw the emptied device view before the next "before" picture
  }
}

// Loads one plugin/device onto Live's selected track, picking the exact entry from the search results.
// Falls back to the first result when the name can't be read (e.g. without Screen Recording permission).
let loader;
// Creates a new track in Live (Create menu: item 1 = audio track, item 2 = MIDI track); Live selects it.
async function newTrack(kind) {
  const r = await helper(['menu', '5', kind === 'midi' ? '2' : '1']);
  await sleep(250);
  return r?.ok === true;
}

async function loadExact(plugin, opts = {}) {
  const query = plugin.liveName || plugin.name;
  if (!available()) {
    if (opts.newTrack) await newTrack(plugin.type === 'Effect' ? 'audio' : 'midi');
    return ableton.loadPlugin({ ...plugin, name: query });
  }
  if (!loader) loader = new LiveIndexer(os.tmpdir(), {}, () => {});
  const tmp = path.join(os.tmpdir(), `po-load-${process.pid}.png`);
  // New track first: Live selects it, and the search typed afterwards starts with a fresh result list.
  if (opts.newTrack) await newTrack(plugin.type === 'Effect' ? 'audio' : 'midi');
  await ableton.search(query);
  await sleep(200);
  let { main, index } = await findInResults(loader, query, tmp, Date.now() + 3000);
  if (index < 0) {
    // Live sometimes misses the typing while busy: type once more.
    await ableton.search(query);
    await sleep(500);
    ({ main, index } = await findInResults(loader, query, tmp, Date.now() + 3000));
  }
  // Never load a different item: without an exact hit, report it (and remove the track we just made).
  if (index < 0) {
    if (opts.newTrack) {
      const label = (await helper(['undolabel']))?.label || '';
      if (/Spur|Track/.test(label)) await helper(['menu', '4', '1']);
    }
    fs.rm(tmp, () => {});
    throw new Error(`„${query}“ wurde in Lives Browser nicht gefunden.`);
  }
  await loader.pickVerified(main, index, tmp);
  fs.rm(tmp, () => {});
  return { exact: true };
}

module.exports = { LiveIndexer, available, requestAccess, loadExact };
