// Builds the Stream Deck plugin: bundles src/plugin.js (with ws) into the .sdPlugin folder,
// renders the key/plugin icons from the app icon and packs dist/<uuid>.streamDeckPlugin.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plugin = path.join(__dirname, 'de.frequenzbetrieb.pluginorganizer.sdPlugin');
const imgs = path.join(plugin, 'imgs');

require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'src', 'plugin.js')],
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  outfile: path.join(plugin, 'bin', 'plugin.js'),
  // ws optionally loads native speed-ups; the plain JS fallback is fine for a few messages.
  external: ['bufferutil', 'utf-8-validate'],
});

// Icons: plugin (256/512) and default key image (72/144) from the app icon.
const icon = path.join(root, 'build', 'icon.png');
const sizes = { plugin: 256, 'plugin@2x': 512, key: 72, 'key@2x': 144 };
for (const [name, px] of Object.entries(sizes)) {
  const out = path.join(imgs, `${name}.png`);
  if (process.platform === 'darwin') execFileSync('sips', ['-z', String(px), String(px), icon, '--out', out], { stdio: 'ignore' });
  else if (!fs.existsSync(out)) fs.copyFileSync(icon, out);
}

// Plain key images: dark background (blank content key) and a slightly lighter one for navigation.
const zlib = require('zlib');
function solidPng(file, size, [r, g, b]) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())]);
  const idat = zlib.deflateSync(Buffer.concat(Array(size).fill(row)));
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}
for (const [name, rgb] of [['blank', [20, 21, 26]], ['nav', [34, 37, 46]]]) {
  solidPng(path.join(imgs, `${name}.png`), 72, rgb);
  solidPng(path.join(imgs, `${name}@2x.png`), 144, rgb);
}
for (const n of ['browse', 'browse@2x']) fs.copyFileSync(path.join(imgs, n.includes('@2x') ? 'key@2x.png' : 'key.png'), path.join(imgs, `${n}.png`));

// Browser profile for the 15-key Stream Deck (5×3): 12 content keys (columns 0–3) + ◀ ▶ ↩ in column 4.
// Format of a bundled .streamDeckProfile: zip with <UUID>.sdProfile/manifest.json, actions keyed "column,row".
const state = { FFamily: '', FSize: '', FStyle: '', FUnderline: '', Image: '', Title: '', TitleAlignment: '', TitleColor: '', TitleShow: '' };
const act = (uuid, name, settings) => ({ Name: name, Settings: settings, State: 0, States: [state], UUID: uuid });
const actions = {};
for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) actions[`${col},${row}`] = act('de.frequenzbetrieb.pluginorganizer.slot', 'Browser-Taste', {});
actions['4,0'] = act('de.frequenzbetrieb.pluginorganizer.nav', 'Zurückblättern', { nav: 'prev' });
actions['4,1'] = act('de.frequenzbetrieb.pluginorganizer.nav', 'Weiterblättern', { nav: 'next' });
actions['4,2'] = act('de.frequenzbetrieb.pluginorganizer.nav', 'Zurück', { nav: 'back' });
const profileUuid = 'F1E9B2C3-4D5E-4F60-8A1B-2C3D4E5F6071';
const profTmp = path.join(__dirname, '.profile-build');
fs.rmSync(profTmp, { recursive: true, force: true });
fs.mkdirSync(path.join(profTmp, `${profileUuid}.sdProfile`), { recursive: true });
fs.writeFileSync(path.join(profTmp, `${profileUuid}.sdProfile`, 'manifest.json'), JSON.stringify({
  Actions: actions, DeviceModel: '20GBA9901', DeviceUUID: '', InstalledByPluginUUID: 'de.frequenzbetrieb.pluginorganizer',
  Name: 'Frequenzbetrieb Browser', PreconfiguredName: 'profiles/Frequenzbetrieb Browser', Version: '1.0',
}, null, 1));
fs.mkdirSync(path.join(plugin, 'profiles'), { recursive: true });
const profFile = path.join(plugin, 'profiles', 'Frequenzbetrieb Browser.streamDeckProfile');
fs.rmSync(profFile, { force: true });
if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', path.join(profTmp), profFile]);
else execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.join(profTmp, '*')}' -DestinationPath '${profFile}.zip'; Move-Item '${profFile}.zip' '${profFile}'`]);
fs.rmSync(profTmp, { recursive: true, force: true });

// Pack: a .streamDeckPlugin is a zip with the .sdPlugin folder at its root.
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const pkg = path.join(dist, 'Frequenzbetrieb-Plugin-Organizer.streamDeckPlugin');
fs.rmSync(pkg, { force: true });
if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--keepParent', plugin, pkg]);
else execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${plugin}' -DestinationPath '${pkg}.zip'; Move-Item '${pkg}.zip' '${pkg}'`]);
console.log(`built ${pkg}`);
