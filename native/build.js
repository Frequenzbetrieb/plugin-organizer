// Builds the native helpers on macOS; on other systems there is nothing to build yet.
const { execFileSync } = require('child_process');
const path = require('path');

if (process.platform === 'darwin') {
  execFileSync('sh', [path.join(__dirname, 'build-mac.sh')], { stdio: 'inherit' });
} else {
  console.log('native helpers: only needed on macOS, skipping');
}
