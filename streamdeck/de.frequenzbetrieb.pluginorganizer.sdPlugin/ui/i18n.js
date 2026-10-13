// German/English for the property inspectors. The pages are written in German; for any other
// Stream Deck language every visible text is translated (also texts added later, via MutationObserver).
(function () {
  const EN = {
    'Plugin': 'Plugin', 'Noch keins gewählt': 'None chosen yet', 'Noch keins gewählt – unten suchen und anklicken': 'None chosen yet – search below and click one',
    'Typ': 'Type', 'Quelle': 'Source', 'Kategorie': 'Category', 'Alle': 'All', 'Effekte': 'Effects', 'Instrumente': 'Instruments',
    'Plugins': 'Plugins', 'Stock (Ableton)': 'Stock (Ableton)', 'Max for Live': 'Max for Live', 'Racks & Presets': 'Racks & presets',
    'Alle Kategorien': 'All categories', 'Suchen – Name, Hersteller, Kategorie …': 'Search – name, vendor, category …',
    'Auf neuer Spur laden': 'Load on a new track', 'Name auf der Taste anzeigen': 'Show name on the key', 'Nichts gefunden.': 'Nothing found.',
    'Plugin Organizer nicht erreichbar – bitte die App starten (ab Version 0.3.0).': 'Plugin Organizer not reachable – please start the app (version 0.3.0 or later).',
    'Start bei': 'Start at', 'Übersicht (Bereiche, Favoriten, Sammlungen)': 'Overview (areas, favourites, collections)', '★ Favoriten': '★ Favourites',
    'Ein Druck öffnet das Profil': 'One press opens the profile', '„Frequenzbetrieb Browser“': '“Frequenzbetrieb Browser”',
    ': 12 Tasten mit Bild, rechts': ': 12 keys with pictures, on the right', 'zum Blättern und': 'to page and',
    'eine Ebene zurück (in der Übersicht: zurück zu deinem Profil).': 'one level back (in the overview: back to your profile).',
    'Auf einem Plugin:': 'On a plugin:', 'kurz drücken': 'short press', 'lädt es auf die ausgewählte Spur,': 'loads it onto the selected track,',
    'lang drücken': 'long press', '(½ s) auf eine neue Spur.': '(½ s) onto a new track.',
  };
  const PATTERNS = [
    [/^Alle Kategorien \((\d+)\)$/, 'All categories ($1)'],
    [/^(\d+) von (\d+) – Suche oder Kategorie eingrenzen$/, '$1 of $2 – narrow down with search or category'],
    [/^(\d+) Einträge$/, '$1 entries'],
    [/^Plugin Organizer (.*) verbunden · Ableton Live läuft$/, 'Plugin Organizer $1 connected · Ableton Live is running'],
    [/^Plugin Organizer (.*) verbunden · Ableton Live nicht gestartet$/, 'Plugin Organizer $1 connected · Ableton Live is not running'],
  ];
  let en = false;
  function tr(s) {
    if (!en || !s) return s;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = m[2].replace(/\s*\n\s*/g, ' ');
    let out = EN[core];
    if (out === undefined) for (const [re, rep] of PATTERNS) if (re.test(core)) { out = core.replace(re, rep); break; }
    return out === undefined ? s : m[1] + out + m[3];
  }
  function walk(node) {
    if (node.nodeType === 3) { const v = tr(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v; return; }
    if (node.nodeType !== 1) return;
    if (node.placeholder) node.placeholder = tr(node.placeholder);
    node.childNodes.forEach(walk);
  }
  // lang: Stream Deck's application.language ("de", "en", "fr", …) – German only for "de".
  function setLang(lang) {
    en = !/^de/i.test(lang || 'de');
    document.documentElement.lang = en ? 'en' : 'de';
    if (!en) return;
    walk(document.body);
    new MutationObserver((list) => list.forEach((r) => (r.type === 'characterData' ? walk(r.target) : r.addedNodes.forEach(walk))))
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  window.PI_I18N = { setLang };
})();
