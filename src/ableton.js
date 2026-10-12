// Ableton Live bridge: detects Live and loads a plugin onto the selected track
// by driving Live's browser search (Cmd/Ctrl+F → name → ↓ → Enter), like a user would.
const { execFile } = require('child_process');

const isMac = process.platform === 'darwin';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

async function isRunning() {
  try {
    if (isMac) {
      const out = await run('pgrep', ['-x', 'Live']);
      return out.trim().length > 0;
    }
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq Ableton Live*', '/NH']);
    return /Ableton Live/i.test(out);
  } catch {
    return false;
  }
}

// Formats Ableton Live can load.
const SUPPORTED_FORMATS = isMac ? ['AU', 'VST', 'VST3', 'Stock', 'Max'] : ['VST', 'VST3', 'Stock', 'Max'];

function appleScriptString(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function sendKeysEscape(s) {
  return s.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`);
}

async function loadPlugin(plugin) {
  if (!(await isRunning())) throw new Error('Ableton Live läuft nicht.');
  const query = plugin.name;

  if (isMac) {
    const script = `
      tell application "System Events"
        set liveProc to first process whose name is "Live"
        set frontmost of liveProc to true
        delay 0.2
        keystroke "f" using command down
        delay 0.3
        keystroke "a" using command down
        keystroke ${appleScriptString(query)}
        delay 1.5
        key code 125
        delay 0.4
        key code 36
      end tell`;
    await run('osascript', ['-e', script]);
    return;
  }

  const ps = `
    $w = New-Object -ComObject WScript.Shell
    $p = Get-Process | Where-Object { $_.MainWindowTitle -match 'Ableton Live' } | Select-Object -First 1
    if (-not $p) { exit 1 }
    $null = $w.AppActivate($p.Id)
    Start-Sleep -Milliseconds 200
    $w.SendKeys('^f'); Start-Sleep -Milliseconds 150
    $w.SendKeys('^a')
    $w.SendKeys('${sendKeysEscape(query).replace(/'/g, "''")}')
    Start-Sleep -Milliseconds 1500
    $w.SendKeys('{DOWN}'); Start-Sleep -Milliseconds 400
    $w.SendKeys('{ENTER}')`;
  await run('powershell', ['-NoProfile', '-Command', ps]);
}

// Undoes the last action in Live (removes a device that was just loaded).
async function undo() {
  if (isMac) {
    await run('osascript', ['-e', `
      tell application "System Events"
        set frontmost of (first process whose name is "Live") to true
        delay 0.1
        key code 53
        delay 0.1
        keystroke "z" using command down
      end tell`]);
    return;
  }
  await run('powershell', ['-NoProfile', '-Command', `
    $w = New-Object -ComObject WScript.Shell
    $p = Get-Process | Where-Object { $_.MainWindowTitle -match 'Ableton Live' } | Select-Object -First 1
    $null = $w.AppActivate($p.Id); Start-Sleep -Milliseconds 150
    $w.SendKeys('{ESC}'); $w.SendKeys('^z')`]);
}

// Two-step loading for indexing: type the search, then pick result number `index` (0 = first).
async function search(query) {
  if (!isMac) throw new Error('Nur macOS');
  await run('osascript', ['-e', `
    tell application "System Events"
      set frontmost of (first process whose name is "Live") to true
      tell process "Live"
        -- Max devices can open windows that grab the keyboard; bring the main window back.
        try
          perform action "AXRaise" of (first window whose name does not contain "/" and subrole is "AXStandardWindow")
        end try
      end tell
      delay 0.12
      keystroke "f" using command down
      delay 0.15
      keystroke "a" using command down
      -- Clear first: with an unchanged query Live keeps the old selection in the result list.
      key code 51
      delay 0.25
      keystroke ${appleScriptString(query)}
    end tell`]);
}

// refocus: put the keyboard focus back into the search field first (e.g. after creating a track).
async function pickResult(index, refocus = false) {
  await run('osascript', ['-e', `
    tell application "System Events"
      set frontmost of (first process whose name is "Live") to true
      delay 0.1
      ${refocus ? 'keystroke "f" using command down\n      delay 0.25' : ''}
      repeat ${index + 1} times
        key code 125
        delay 0.04
      end repeat
      delay 0.15
      key code 36
    end tell`]);
}

// Name of the top entry in Live's Edit menu ("… widerrufen" / "Undo …").
async function undoLabel() {
  if (!isMac) return '';
  return (await run('osascript', ['-e', `
    tell application "System Events" to tell process "Live"
      get name of menu item 1 of menu 1 of menu bar item 4 of menu bar 1
    end tell`]).catch(() => '')).trim();
}

// Arrow keys in Live's browser (n > 0: down, n < 0: up), optionally followed by Enter.
async function arrows(n, enter = false) {
  await run('osascript', ['-e', `
    tell application "System Events"
      set frontmost of (first process whose name is "Live") to true
      repeat ${Math.abs(n)} times
        key code ${n < 0 ? 126 : 125}
        delay 0.04
      end repeat
      ${enter ? 'delay 0.12\n      key code 36' : ''}
    end tell`]);
}

// Undoes loading a device through Live's Edit menu (⌘Z would only undo typing in the browser search).
// `before` is the top undo entry from before the load: undo until we are back there. Devices may insert
// more than one device and tweak their own parameters, so several steps can be needed.
// Live spells umlauts decomposed, so only umlaut-free word parts are compared ("einf", "ndern").
async function undoLoad(before) {
  if (!isMac) { await undo(); return 'removed'; }
  const out = await run('osascript', ['-e', `
    set beforeLabel to ${appleScriptString(before || '')}
    tell application "System Events" to tell process "Live"
      set frontmost to true
      set editMenu to menu 1 of menu bar item 4 of menu bar 1
      set inserts to 0
      set clicks to 0
      repeat 12 times
        set n to name of menu item 1 of editMenu
        -- Back where we started: everything we caused is undone.
        if clicks > 0 and (n is beforeLabel or n contains "Nichts" or n contains "Nothing") then return "removed"
        if clicks = 0 and (n contains "Nichts" or n contains "Nothing") then return "skipped: " & n
        set isInsert to (n contains "einf" or n contains "Insert") and not (n contains "ndern" or n contains "nderung" or n contains "Change")
        click menu item 1 of editMenu
        set clicks to clicks + 1
        -- Live updates the menu label with a delay.
        delay 0.25
        if isInsert then set inserts to inserts + 1
        if isInsert and beforeLabel is "" then return "removed"
      end repeat
      if inserts > 0 then return "removed"
      return "skipped: too many steps"
    end tell`]).catch((e) => `skipped: ${e.message}`);
  return out.trim();
}

// Closes open plugin windows (their titles look like "Track/Plugin").
async function closePluginWindows() {
  if (!isMac) return;
  await run('osascript', ['-e', `
    tell application "System Events" to tell process "Live"
      repeat with w in (windows whose name contains "/")
        try
          click (first button of w whose subrole is "AXCloseButton")
        end try
      end repeat
    end tell`]).catch(() => {});
}

module.exports = { isRunning, loadPlugin, search, pickResult, arrows, undo, undoLabel, undoLoad, closePluginWindows, SUPPORTED_FORMATS };
