// Location of the native helpers: next to the sources while developing,
// in the app's Resources folder (outside the asar archive) in the packaged app.
const path = require('path');

const packaged = __dirname.includes('app.asar');
const binDir = packaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'bin');
const bin = (name) => path.join(binDir, process.platform === 'win32' ? `${name}.exe` : name);

module.exports = { bin, binDir, packaged };
