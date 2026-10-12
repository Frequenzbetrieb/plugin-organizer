// Keyboard layouts (German Mac keyboard) for the mapping panel.
// A key is [id, label, width] – id is the Electron accelerator name (null = not mappable), width in key units.
// '|' starts a new block (main / navigation / numpad), null entries are gaps.
(() => {
const K = (id, label = id, w = 1) => ({ id, label, w });
const X = (label, w = 1) => ({ id: null, label, w }); // shown, but not mappable
const GAP = (w = 0.5) => ({ gap: true, w });

const FN_ROW = [K(null, 'esc'), GAP(), ...[1, 2, 3, 4].map((n) => K(`F${n}`)), GAP(0.3), ...[5, 6, 7, 8].map((n) => K(`F${n}`)), GAP(0.3), ...[9, 10, 11, 12].map((n) => K(`F${n}`))];
const DIGIT_ROW = [X('<'), ...'1234567890'.split('').map((c) => K(c)), X('ß'), X('´'), X('⌫', 1.5)];
const ROW_Q = [X('⇥', 1.5), ...'QWERTZUIOP'.split('').map((c) => K(c)), X('Ü'), X('+'), X('↩', 1)];
const ROW_A = [X('⇪', 1.75), ...'ASDFGHJKL'.split('').map((c) => K(c)), X('Ö'), X('Ä'), X('#'), X('', 0.75)];
const ROW_Y = [X('⇧', 1.25), ...'YXCVBNM'.split('').map((c) => K(c)), X(','), X('.'), X('-'), X('⇧', 2.25)];
const ROW_SPACE = [X('ctrl', 1.25), X('⌥', 1.25), X('⌘', 1.5), K('Space', 'Leertaste', 5.5), X('⌘', 1.5), X('⌥', 1.25), X('ctrl', 1.25)];

const NAV = [
  [K('F13'), K('F14'), K('F15')],
  [X('fn'), K('Home', '↖'), K('PageUp', '⇞')],
  [K('Delete', '⌦'), K('End', '↘'), K('PageDown', '⇟')],
  [],
  [GAP(1), K('Up', '↑')],
  [K('Left', '←'), K('Down', '↓'), K('Right', '→')],
];
const NUMPAD = [
  [K('F16'), K('F17'), K('F18'), K('F19')],
  [X('clear'), X('='), K('numdiv', '÷'), K('nummult', '×')],
  [K('num7', '7'), K('num8', '8'), K('num9', '9'), K('numsub', '−')],
  [K('num4', '4'), K('num5', '5'), K('num6', '6'), K('numadd', '+')],
  [K('num1', '1'), K('num2', '2'), K('num3', '3'), X('enter')],
  [K('num0', '0', 2), K('numdec', ',')],
];

const LAYOUTS = {
  full: { label: 'Voll · mit Ziffernblock', blocks: [[FN_ROW, DIGIT_ROW, ROW_Q, ROW_A, ROW_Y, ROW_SPACE], NAV, NUMPAD] },
  tkl: { label: 'Ohne Ziffernblock', blocks: [[FN_ROW, DIGIT_ROW, ROW_Q, ROW_A, ROW_Y, ROW_SPACE], NAV] },
  laptop: { label: 'MacBook', blocks: [[FN_ROW, DIGIT_ROW, ROW_Q, ROW_A, ROW_Y, ROW_SPACE]] },
  compact: { label: 'Kompakt · nur Buchstaben & Ziffern', blocks: [[DIGIT_ROW, ROW_Q, ROW_A, ROW_Y].map((r) => r.filter((k) => k.id))] },
};

// What Ableton Live does with these keys on their own (without modifiers).
const LIVE_SHORTCUTS = {
  F1: 'Spur 1 an/aus', F2: 'Spur 2 an/aus', F3: 'Spur 3 an/aus', F4: 'Spur 4 an/aus',
  F5: 'Spur 5 an/aus', F6: 'Spur 6 an/aus', F7: 'Spur 7 an/aus', F8: 'Spur 8 an/aus',
  F9: 'Aufnahme', F10: 'Zurück zum Arrangement', F12: 'Session-Record',
  Space: 'Start/Stopp', Home: 'Zum Anfang', End: 'Zum Ende', PageUp: 'Scrollen', PageDown: 'Scrollen',
  Up: 'Auswahl hoch', Down: 'Auswahl runter', Left: 'Nudge zurück', Right: 'Nudge vor', Delete: 'Löschen',
};

// Modifier combinations offered for global hotkeys.
const MODIFIERS = [
  { value: 'Control+Alt+Command', label: '⌃⌥⌘', note: 'frei – nichts in Live nutzt diese Kombination' },
  { value: 'Control+Alt', label: '⌃⌥', note: 'Live nutzt einige ⌃⌥-Kombinationen' },
  { value: 'Alt+Command', label: '⌥⌘', note: 'Live nutzt einige ⌥⌘-Kombinationen (z. B. ⌥⌘B Browser)' },
  { value: 'Control+Shift', label: '⌃⇧', note: 'meist frei' },
  { value: '', label: 'ohne (nur in Live)', note: 'Taste allein – aktiv nur, solange Live vorne ist. Überschreibt dort Lives eigene Belegung dieser Taste (gestrichelt markiert); am besten F-Tasten oder Ziffernblock nutzen.' },
];

// Maps a keydown event to a key id (letters/digits by character, so the German layout matches the labels).
function keyIdFromEvent(e) {
  if (/^[a-z0-9]$/i.test(e.key) && !e.code.startsWith('Numpad')) return e.key.toUpperCase();
  const map = {
    Space: 'Space', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    NumpadDivide: 'numdiv', NumpadMultiply: 'nummult', NumpadSubtract: 'numsub', NumpadAdd: 'numadd', NumpadDecimal: 'numdec',
  };
  if (map[e.code]) return map[e.code];
  if (/^Numpad\d$/.test(e.code)) return `num${e.code.slice(6)}`;
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  return null;
}

// Short label for a key id (used in toasts and card badges).
function keyLabel(id) {
  for (const layout of Object.values(LAYOUTS)) {
    for (const block of layout.blocks) for (const row of block) for (const k of row) if (k.id === id) return k.label;
  }
  return id;
}

window.Keyboard = { LAYOUTS, LIVE_SHORTCUTS, MODIFIERS, keyIdFromEvent, keyLabel };
})();
