// Scans the standard plugin folders and extracts name, vendor, format and category.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const zlib = require('zlib');
const { classify, classifyStock } = require('./taxonomy');
// (SCANNER_VERSION in main.js triggers a rescan when this file learns something new.)

const isMac = process.platform === 'darwin';
const home = os.homedir();

const SOURCES = isMac
  ? [
      { format: 'AU', ext: '.component', dirs: ['/Library/Audio/Plug-Ins/Components', `${home}/Library/Audio/Plug-Ins/Components`] },
      { format: 'VST', ext: '.vst', dirs: ['/Library/Audio/Plug-Ins/VST', `${home}/Library/Audio/Plug-Ins/VST`] },
      { format: 'VST3', ext: '.vst3', dirs: ['/Library/Audio/Plug-Ins/VST3', `${home}/Library/Audio/Plug-Ins/VST3`] },
      { format: 'AAX', ext: '.aaxplugin', dirs: ['/Library/Application Support/Avid/Audio/Plug-Ins'] },
      { format: 'CLAP', ext: '.clap', dirs: ['/Library/Audio/Plug-Ins/CLAP', `${home}/Library/Audio/Plug-Ins/CLAP`] },
    ]
  : [
      { format: 'VST3', ext: '.vst3', dirs: ['C:\\Program Files\\Common Files\\VST3'] },
      { format: 'VST', ext: '.dll', dirs: ['C:\\Program Files\\VSTPlugins', 'C:\\Program Files\\Steinberg\\VSTPlugins', 'C:\\Program Files\\Common Files\\VST2'] },
      { format: 'AAX', ext: '.aaxplugin', dirs: ['C:\\Program Files\\Common Files\\Avid\\Audio\\Plug-Ins'] },
      { format: 'CLAP', ext: '.clap', dirs: ['C:\\Program Files\\Common Files\\CLAP'] },
    ];


function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

async function readPlist(file) {
  if (!isMac || !fs.existsSync(file)) return null;
  const out = await run('plutil', ['-convert', 'json', '-o', '-', file]);
  try { return out ? JSON.parse(out) : null; } catch { return null; }
}

// moduleinfo.json is JSON5-ish (trailing commas, comments).
function readModuleInfo(bundle) {
  const file = path.join(bundle, 'Contents', 'Resources', 'moduleinfo.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(raw);
  } catch { return null; }
}

function vendorFromBundleId(id) {
  if (!id) return null;
  const parts = id.split('.');
  const v = parts.length > 1 ? parts[1] : null;
  if (!v) return null;
  return v.charAt(0).toUpperCase() + v.slice(1);
}


async function describe(bundle, format) {
  const base = path.basename(bundle).replace(/\.[^.]+$/, '');
  let name = base;
  let vendor = null;
  let hints = '';
  let icon = null;

  const plist = await readPlist(path.join(bundle, 'Contents', 'Info.plist'));
  if (plist) {
    vendor = vendorFromBundleId(plist.CFBundleIdentifier);
    if (plist.CFBundleIconFile) {
      const f = plist.CFBundleIconFile.endsWith('.icns') ? plist.CFBundleIconFile : `${plist.CFBundleIconFile}.icns`;
      const p = path.join(bundle, 'Contents', 'Resources', f);
      if (fs.existsSync(p)) icon = p;
    }
  }

  if (format === 'AU' && plist?.AudioComponents?.length) {
    // One bundle can hold many components (e.g. WaveShell).
    return plist.AudioComponents.map((c) => {
      const [v, n] = String(c.name || '').split(/:\s*/);
      const cname = n || v || base;
      return {
        id: `AU:${bundle}:${c.type}:${c.subtype}:${c.manufacturer}`,
        name: cname,
        vendor: (n ? v : vendor) || 'Unknown',
        format,
        ...classify(cname, `${c.type} ${c.description || ''}`),
        source: 'Plugin',
        path: bundle,
        icon,
        au: { type: c.type, subtype: c.subtype, manufacturer: c.manufacturer },
      };
    });
  } else if (format === 'VST3') {
    const info = readModuleInfo(bundle);
    const cls = info?.Classes?.find((c) => c.Category === 'Audio Module Class');
    if (cls) {
      name = cls.Name || name;
      vendor = cls.Vendor || info.Factory?.Vendor || vendor;
      hints = (cls['Sub Categories'] || []).join(' ');
    } else if (info?.Factory?.Vendor) {
      vendor = info.Factory.Vendor;
    }
  }

  return {
    id: `${format}:${bundle}`,
    name,
    vendor: vendor || 'Unknown',
    format,
    ...classify(name, hints),
    source: 'Plugin',
    path: bundle,
    icon,
  };
}

function listBundles(dir, ext, depth = 0) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name.toLowerCase().endsWith(ext)) out.push(full);
    else if (e.isDirectory() && depth < 3) out = out.concat(listBundles(full, ext, depth + 1));
  }
  return out;
}

async function scan(onProgress, cacheDir) {
  const jobs = [];
  for (const src of SOURCES) {
    for (const dir of src.dirs) {
      for (const b of listBundles(dir, src.ext)) jobs.push([b, src.format]);
    }
  }
  const results = [];
  const LIMIT = 16;
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const [b, f] = jobs[i++];
      results.push(...[].concat(await describe(b, f)));
      onProgress?.(results.length, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: LIMIT }, worker));
  // Helper components that aren't loadable plugins.
  const junk = /AAXHook$|^ASAF |AES3 Audio Decoder|^Apple (AUNetSend|AUNetReceive)|^WaveShell\d/;
  for (let i = results.length - 1; i >= 0; i--) if (junk.test(results[i].name)) results.splice(i, 1);
  normalize(results);
  results.push(...scanStock(), ...(await scanMax()), ...(await scanPresets(cacheDir)));
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// Bundle IDs sometimes yield generic words instead of a maker ("com.….vst3", "Synth", "FX2x8", "Uaudio").
const GENERIC_VENDOR = /^(vst3?|synth|fx(\d+x\d+)?|mfx|audiounit|au|aax|clap|plugins?|component|instrument|effects?|unknown)$/i;

// Makers whose bundle IDs use a short name ("com.uaudio…") instead of the real one.
const VENDOR_ALIAS = { uaudio: 'Universal Audio', 'native-instruments': 'Native Instruments', nativeinstruments: 'Native Instruments', wavesaudio: 'Waves' };

// Unifies vendor spelling and shares the best-known category across formats.
function normalize(list) {
  for (const p of list) {
    const alias = VENDOR_ALIAS[p.vendor.toLowerCase()];
    if (alias) p.vendor = alias;
  }
  // A plugin known under a real maker in one format gets that maker in all formats.
  const realVendor = new Map();
  for (const p of list) {
    if (!GENERIC_VENDOR.test(p.vendor) && !realVendor.has(p.name.toLowerCase())) realVendor.set(p.name.toLowerCase(), p.vendor);
  }
  for (const p of list) {
    if (GENERIC_VENDOR.test(p.vendor)) p.vendor = realVendor.get(p.name.toLowerCase()) || 'Unknown';
  }
  const vendors = new Map();
  for (const p of list) {
    const k = p.vendor.toLowerCase().replace(/[^a-z0-9]/g, ''); // "IK Multimedia" = "Ikmultimedia" = "IK-Multimedia"
    const cur = vendors.get(k);
    const caps = (s) => (s.match(/[A-Z]/g) || []).length;
    if (!cur || caps(p.vendor) > caps(cur)) vendors.set(k, p.vendor);
  }
  // Share the best-known classification across formats: AU/VST3 carry metadata, VST2 doesn't.
  const score = (p) => (p.category === 'Unsorted' ? 0 : 1) + (p.format === 'AU' || p.format === 'VST3' ? 2 : 0);
  const best = new Map();
  for (const p of list) {
    p.vendor = vendors.get(p.vendor.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const k = p.name.toLowerCase();
    if (!best.has(k) || score(p) > score(best.get(k))) best.set(k, p);
  }
  for (const p of list) {
    const b = best.get(p.name.toLowerCase());
    if (p.source === 'Plugin' && b !== p && score(b) > score(p)) Object.assign(p, { type: b.type, category: b.category, sub: b.sub });
  }
}

// ---------- Ableton Live ----------
function liveApps() {
  const roots = isMac ? ['/Applications'] : ['C:\\ProgramData\\Ableton', 'C:\\Program Files\\Ableton'];
  const out = [];
  for (const r of roots) {
    try {
      for (const e of fs.readdirSync(r)) {
        if (!/^Ableton Live/i.test(e) && !/^Live \d/i.test(e)) continue;
        const res = isMac ? path.join(r, e, 'Contents', 'App-Resources') : path.join(r, e, 'Resources');
        if (fs.existsSync(path.join(res, 'Core Library'))) out.push(res);
      }
    } catch { /* not installed */ }
  }
  return out.sort().reverse(); // newest version first
}

// Built-in devices = the device folders in Live's Core Library.
function scanStock() {
  const res = liveApps()[0];
  if (!res) return [];
  const base = path.join(res, 'Core Library', 'Devices');
  const skip = /^(Ableton Folder Info|Legacy|Max (Audio Effect|Instrument|MIDI Effect))$/;
  const out = [];
  for (const folder of ['Audio Effects', 'Instruments', 'MIDI Effects']) {
    let names = [];
    try { names = fs.readdirSync(path.join(base, folder)); } catch { continue; }
    for (const name of names) {
      if (skip.test(name) || name.startsWith('.')) continue;
      out.push({
        id: `Stock:${name}`, name, vendor: 'Ableton', format: 'Stock', source: 'Stock',
        path: path.join(base, folder, name), icon: null, ...classifyStock(name, folder),
      });
    }
  }
  return out;
}

// Folders Live knows about (User Library, Packs), read from the newest Library.cfg.
function liveLibraryFolders() {
  const dirs = [];
  const prefs = isMac ? path.join(home, 'Library', 'Preferences', 'Ableton') : path.join(process.env.APPDATA || '', 'Ableton');
  try {
    const versions = fs.readdirSync(prefs).filter((d) => /^Live \d/.test(d))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const cfg = fs.readFileSync(path.join(prefs, versions.pop(), isMac ? 'Library.cfg' : path.join('Preferences', 'Library.cfg')), 'utf8');
    for (const m of cfg.matchAll(/<ProjectPath Value="([^"]+)"/g)) dirs.push(m[1]);
  } catch { /* no Live prefs */ }
  dirs.push(path.join(home, 'Music', 'Ableton'));
  return [...new Set(dirs)].filter((d) => fs.existsSync(d));
}

// Max for Live devices (.amxd); the header says whether it's an effect, instrument or MIDI device.
async function scanMax() {
  const roots = liveLibraryFolders();
  let files = [];
  if (isMac) {
    const out = await run('mdfind', ['-name', '.amxd']);
    files = (out || '').split('\n').filter((f) => f.endsWith('.amxd') && roots.some((r) => f.startsWith(r)));
  }
  if (!files.length) for (const r of roots) files = files.concat(listBundles(r, '.amxd', -3));
  const seen = new Set();
  const out = [];
  // Lesson and building-block devices from Ableton's tutorial packs aren't real instruments/effects.
  files = files.filter((f) => !/\/(Lessons?|Lesson Devices|Building Blocks|API|Tutorials?)\//i.test(f) && !/Building (Tools|Max Devices)/i.test(f));
  for (const f of files) {
    const name = path.basename(f, '.amxd');
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    let head = '';
    try {
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      head = buf.toString('latin1');
    } catch { /* unreadable */ }
    // Real Max devices start with "ampf"; cloud placeholders and broken files are skipped.
    if (!head.startsWith('ampf')) continue;
    const kind = head.slice(8, 12);
    // Vendor = the pack the device comes from (the folder right after "…Packs").
    const parts = f.split(path.sep);
    const pi = parts.findIndex((x) => /packs$/i.test(x));
    const pack = pi >= 0 && parts[pi + 1] && !parts[pi + 1].endsWith('.amxd') ? parts[pi + 1] : /user library/i.test(f) ? 'User Library' : 'Max for Live';
    // Live 12 MIDI Tools (generators "nagg", transformations "natt") work in the clip view, not on a track.
    const midiTool = kind === 'nagg' || kind === 'natt';
    const folder = kind === 'iiii' ? 'Instruments' : kind === 'mmmm' || midiTool ? 'MIDI Effects' : 'Audio Effects';
    const cls = midiTool
      ? { type: 'MIDI FX', category: 'MIDI Tools', sub: kind === 'nagg' ? 'Generator' : 'Transformation' }
      : classifyStock(name, folder);
    out.push({
      id: `Max:${f}`, name, vendor: pack, format: 'Max', source: 'Max',
      path: f, icon: null, ...cls, ...(midiTool ? { midiTool: true } : {}),
    });
  }
  return out;
}

// ---------- Racks & presets (.adg / .adv) ----------
// Live's internal device tag → name shown in the browser (instruments; MIDI tags start with "Midi").
const INSTRUMENT_TAGS = {
  Operator: 'Operator', OriginalSimpler: 'Simpler', InstrumentVector: 'Wavetable', MultiSampler: 'Sampler', StringStudio: 'Tension',
  UltraAnalog: 'Analog', Drift: 'Drift', InstrumentMeld: 'Meld', Collision: 'Collision', LoungeLizard: 'Electric',
  InstrumentImpulse: 'Impulse', DrumCell: 'Drum Sampler', MxDeviceInstrument: 'Max Instrument',
};
const DEVICE_NAMES = {
  Eq8: 'EQ Eight', FilterEQ3: 'EQ Three', AutoFilter2: 'Auto Filter', AutoPan2: 'Auto Pan', Compressor2: 'Compressor',
  Chorus2: 'Chorus-Ensemble', PhaserNew: 'Phaser-Flanger', Erosion2: 'Erosion', Redux2: 'Redux', Hybrid: 'Hybrid Reverb',
  StereoGain: 'Utility', SpectrumAnalyzer: 'Spectrum', Tube: 'Dynamic Tube', Vinyl: 'Vinyl Distortion', ChannelEq: 'Channel EQ',
  MidiScale: 'Scale', MidiChord: 'Chord', MidiVelocity: 'Velocity', MidiRandom: 'Random', MidiArpeggiator: 'Arpeggiator',
  MidiNoteLength: 'Note Length', MidiPitcher: 'Pitch', MxDeviceAudioEffect: 'Max Audio Effect', MxDeviceMidiEffect: 'Max MIDI Effect',
};
const RACKS = {
  InstrumentGroupDevice: ['Instrument', 'Instrument Rack'], DrumGroupDevice: ['Instrument', 'Drum Rack'],
  AudioEffectGroupDevice: ['Effect', 'Audio Effect Rack'], MidiEffectGroupDevice: ['MIDI FX', 'MIDI Effect Rack'],
};

// Reads the first device tag from a gzipped Live preset without unpacking the whole file.
function presetTags(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const xml = zlib.gunzipSync(buf.subarray(0, n), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8', 0, 40000);
    const first = xml.match(/<Ableton[^>]*>\s*<(\w+)/);
    const group = xml.match(/<(\w+GroupDevice)[\s>]/);
    return { first: first?.[1], group: group?.[1], drum: xml.includes('<DrumGroupDevice') };
  } catch { return {}; }
}

// Racks and device presets from the User Library, the installed Packs and Live's Core Library.
// Device tags are cached by file date, so a rescan only opens new or changed presets.
async function scanPresets(cacheDir) {
  const roots = liveLibraryFolders();
  const res = liveApps()[0];
  const coreRoot = res ? path.join(res, 'Core Library') : null;
  const skipDir = /^(Samples|Clips|Templates|Grooves|Lessons?|Ableton Project Info|Backup)$/i;
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    let files = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || skipDir.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 8) files = files.concat(walk(full, depth + 1));
      else if (/\.(adg|adv)$/i.test(e.name)) files.push(full);
    }
    return files;
  };
  // Library folders can be a whole drive: ask Spotlight there, walk only Live's own Core Library.
  let files = [];
  if (isMac) {
    for (const ext of ['.adg', '.adv']) {
      const found = (await run('mdfind', ['-name', ext])) || '';
      files = files.concat(found.split('\n').filter((f) => f.toLowerCase().endsWith(ext) && roots.some((r) => f.startsWith(r + path.sep) || f.startsWith(r))));
    }
  }
  if (!files.length) for (const r of roots) files = files.concat(walk(r, 0));
  files = files.filter((f) => !f.split(path.sep).some((x) => skipDir.test(x)));
  const coreFiles = coreRoot ? walk(coreRoot, 0) : [];

  const cacheFile = cacheDir ? path.join(cacheDir, 'preset-tags.json') : null;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* first scan */ }
  const fresh = {};
  const out = [];
  for (const f of [...coreFiles, ...files]) {
    let mtime = 0;
    try { mtime = fs.statSync(f).mtimeMs; } catch { continue; }
    const tags = cache[f]?.m === mtime ? cache[f] : { m: mtime, ...presetTags(f) };
    fresh[f] = tags;
    const { first, group, drum } = tags;
    if (!first) continue;
    const rack = f.toLowerCase().endsWith('.adg');
    const core = coreRoot && f.startsWith(coreRoot);
    const parts = f.split(path.sep);
    const pi = parts.findIndex((x) => /packs$/i.test(x));
    const vendor = core ? 'Ableton' : pi >= 0 && parts[pi + 1] ? parts[pi + 1] : 'User Library';
    let type; let device;
    if (rack) {
      [type, device] = group === 'InstrumentGroupDevice' && drum ? RACKS.DrumGroupDevice : RACKS[group] || RACKS.InstrumentGroupDevice;
    } else {
      // Live's own presets sit in Devices/<Type>/<Device>/…, which names the device exactly.
      const di = parts.lastIndexOf('Devices');
      const folder = core && di >= 0 ? parts[di + 2] : null;
      const fromFolder = folder && !/\.adv$|^Legacy$/i.test(folder) ? folder : null;
      type = INSTRUMENT_TAGS[first] ? 'Instrument' : /^(Midi|MxDeviceMidi)/.test(first) ? 'MIDI FX' : 'Effect';
      device = fromFolder || INSTRUMENT_TAGS[first] || DEVICE_NAMES[first] || first.replace(/([a-z])([A-Z])/g, '$1 $2');
    }
    out.push({
      id: `Preset:${f}`, name: path.basename(f).replace(/\.(adg|adv)$/i, ''), vendor, format: rack ? 'Rack' : 'Preset', source: 'Preset',
      path: f, icon: null, type, category: rack ? 'Racks' : 'Presets', sub: device, device,
    });
  }
  if (cacheFile) try { fs.writeFileSync(cacheFile, JSON.stringify(fresh)); } catch { /* read-only */ }
  return out;
}

// Converts a bundle's .icns into a cached PNG (macOS only).
async function iconPng(icns, cacheDir) {
  if (!isMac || !icns) return null;
  const key = require('crypto').createHash('md5').update(icns).digest('hex');
  const out = path.join(cacheDir, `${key}.png`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(cacheDir, { recursive: true });
  const ok = await run('sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', '256', icns, '--out', out]);
  return ok !== null && fs.existsSync(out) ? out : null;
}

module.exports = { scanPresets, scan, iconPng };
