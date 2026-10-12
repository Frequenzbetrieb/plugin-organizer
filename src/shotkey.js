// Matches format variants of the same plugin, so one picture serves all of them:
// "FabFilter Pro-C 2 (Mono)" (VST2) ↔ "Pro-C 2" by FabFilter (AU), "Battery 4" by "Native-instruments" ↔ "Native Instruments".
// Used by the main process (CommonJS) and the renderer (window.ShotKey).
(function (root) {
  const alnum = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  const VARIANT = /\s*\((mono|stereo|m|s|m->s|mono\/stereo|sc|sc mono|sc stereo|\d+->\d+)\)\s*$/i;
  const SUFFIX = /[\s_-]*(x64|x86|64|mono|stereo)$/i;

  function looseKey(name, vendor) {
    let n = String(name).replace(VARIANT, '').replace(SUFFIX, '');
    n = alnum(n);
    const v = alnum(vendor);
    if (v && n.startsWith(v) && n.length > v.length + 2) n = n.slice(v.length); // "FabFilter Pro-C 2" → "Pro-C 2"
    return `${n}|${v}`;
  }

  // Index of usable pictures by loose key; shot keys look like "name|vendor" (lower case).
  // Also by name alone, for vendor spellings that differ per format ("Uaudio" vs "Universal Audio") –
  // used only when that name belongs to a single picture, so same-named plugins of different makers don't mix.
  function buildIndex(shots) {
    const byKey = new Map();
    const byName = new Map(); // name → { file, vendor }, or null when two vendors share the name
    for (const [key, file] of Object.entries(shots || {})) {
      if (!file || file === 'failed') continue;
      const cut = key.lastIndexOf('|');
      const lk = looseKey(key.slice(0, cut), key.slice(cut + 1));
      if (!byKey.has(lk)) byKey.set(lk, file);
      const name = lk.slice(0, lk.lastIndexOf('|'));
      const vendor = lk.slice(lk.lastIndexOf('|') + 1);
      if (name.length < 4) continue;
      const prev = byName.get(name);
      if (prev === undefined) byName.set(name, { file, vendor });
      else if (prev && prev.vendor !== vendor) byName.set(name, null);
    }
    return {
      get(lk) { return byKey.get(lk) || byName.get(lk.slice(0, lk.lastIndexOf('|')))?.file || null; },
      has(lk) { return Boolean(this.get(lk)); },
    };
  }

  const api = { looseKey, buildIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShotKey = api;
})(typeof window !== 'undefined' ? window : globalThis);
