// Builds the native helpers on macOS; on other systems there is nothing to build yet.
const { execFileSync } = require('child_process');
const path = require('path');

const fs = require('fs');
const root = path.join(__dirname, '..');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root });

if (process.platform === 'darwin') {
  run('sh', [path.join(__dirname, 'build-mac.sh')]);
} else if (process.platform === 'win32') {
  // VST3 snapshot host (C++/Win32), built with CMake + Visual Studio.
  const exe = path.join(root, 'bin', 'vst3-snapshot.exe');
  if (fs.existsSync(exe) && !process.env.FORCE_NATIVE) { console.log('native helpers ready'); process.exit(0); }
  const sdk = path.join(__dirname, 'vst3sdk');
  if (!fs.existsSync(path.join(sdk, 'pluginterfaces', 'base'))) {
    run('git', ['clone', '--depth', '1', 'https://github.com/steinbergmedia/vst3sdk.git', sdk]);
    // Only the parts the host needs (skip VSTGUI and the examples).
    run('git', ['-C', sdk, 'submodule', 'update', '--init', '--depth', '1', 'base', 'pluginterfaces', 'public.sdk']);
  }
  const build = path.join(__dirname, 'vst3snap', 'build');
  run('cmake', ['-S', path.join(__dirname, 'vst3snap'), '-B', build, '-A', 'x64']);
  run('cmake', ['--build', build, '--config', 'Release']);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(build, 'Release', 'vst3-snapshot.exe'), exe);
  console.log('native helpers ready');
} else {
  console.log('native helpers: nothing to build on this system');
}
