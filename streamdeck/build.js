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

// Pack: a .streamDeckPlugin is a zip with the .sdPlugin folder at its root.
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const pkg = path.join(dist, 'Frequenzbetrieb-Plugin-Organizer.streamDeckPlugin');
fs.rmSync(pkg, { force: true });
if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--keepParent', plugin, pkg]);
else execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${plugin}' -DestinationPath '${pkg}.zip'; Move-Item '${pkg}.zip' '${pkg}'`]);
console.log(`built ${pkg}`);
