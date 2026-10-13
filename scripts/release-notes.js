// Prints the CHANGELOG.md section for one version (used as GitHub release text).
// Usage: node scripts/release-notes.js 0.9.1
const fs = require('fs');
const path = require('path');

const version = (process.argv[2] || '').replace(/^v/, '');
const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const parts = text.split(/^## /m);
const section = parts.find((p) => p.startsWith(`[${version}]`));
const body = section ? section.split('\n').slice(1).join('\n').trim() : '';
const dl = 'https://github.com/Frequenzbetrieb/plugin-organizer/releases/download';
process.stdout.write(`${body || '–'}

**Download:** [macOS (DMG)](${dl}/v${version}/Frequenzbetrieb-Plugin-Organizer-macOS-universal.dmg) · [Windows (Installer, Beta)](${dl}/v${version}/Frequenzbetrieb-Plugin-Organizer-Windows-x64-Setup.exe) · [Stream-Deck-Plugin](${dl}/v${version}/Frequenzbetrieb-Plugin-Organizer.streamDeckPlugin)

Wer die App schon hat, bekommt das Update automatisch angeboten. · [Alle Versionen](https://github.com/Frequenzbetrieb/plugin-organizer/blob/main/CHANGELOG.md)
`);
