// German/English. The UI is written in German; in English every visible text (text nodes, titles,
// placeholders, toasts, menus) is translated on the fly by watching the DOM – so code keeps writing German.
(function () {
  const EN = {
    // ---- top bar, filters, views ----
    'Bibliothek': 'Library', 'Health': 'Health', 'Hersteller': 'Vendors', 'Kategorie': 'Category', 'Kategorien': 'Categories',
    'Alle Bilder': 'All pictures', 'Live-Index': 'Live index', 'Ansichten': 'Pictures', 'Scannen': 'Scan', 'Vollbild': 'Full',
    'Sidecar': 'Sidecar', 'Mini': 'Mini', 'Ausblenden': 'Hide', 'Effekte': 'Effects', 'Instrumente': 'Instruments', 'Alle': 'All',
    'Quelle': 'Source', 'Plugins': 'Plugins', 'Presets': 'Presets', 'Format': 'Format', '▦ Kategorien': '▦ Categories',
    '▦ Hersteller': '▦ Vendors', '▤ Raster': '▤ Grid', 'Raster': 'Grid', 'Formate zusammenfassen': 'Merge formats',
    '★ Nur Favoriten': '★ Favourites only', '⌨ Nur belegte': '⌨ Mapped only', '✦ Nur neue': '✦ New only',
    '🗑 Ausgeblendete zeigen': '🗑 Show hidden', 'Eigene': 'Own', '+ Neu': '+ New', 'Weniger zeigen': 'Show less',
    'Kostenlos & Open Source von': 'Free & open source by', '♥ Spenden': '♥ Donate', 'Spenden': 'Donate',
    'Suchen – Name, Hersteller, Kategorie …  ( / )': 'Search – name, vendor, category …  ( / )', 'Sortierung': 'Sort order',
    'Kachelgröße': 'Tile size', 'Name': 'Name', 'Zuletzt geladen': 'Recently loaded', 'Meistgeladen': 'Most loaded',
    'Neu scannen und für alle Plugins, Stock- und Max-Devices ohne Bild eines aufnehmen – AU/VST3 im Hintergrund, der Rest in Ableton Live':
      'Rescan and take a picture of every plugin, stock and Max device without one – AU/VST3 in the background, the rest in Ableton Live',
    'Lädt Plugins ohne Bild in Ableton und fotografiert sie – auch VST2, Stock- und Max-Devices': 'Loads plugins without a picture into Ableton and photographs them – including VST2, stock and Max devices',
    'Ansichten erzeugen: öffnet jedes Plugin unsichtbar und nimmt seine Oberfläche auf': 'Create pictures: opens each plugin invisibly and captures its interface',
    'Ableton Live läuft': 'Ableton Live is running', 'Ableton Live nicht gestartet': 'Ableton Live is not running',
    'Plugin-Ordner neu scannen': 'Rescan plugin folders', 'Ansicht: Vollbild, Sidecar oder Mini': 'View: full, sidecar or mini',
    'App ausblenden – dieselbe Taste holt sie zurück': 'Hide the app – the same key brings it back', 'Hersteller filtern': 'Filter vendors',
    'Aus Bibliothek entfernen – bleibt installiert': 'Remove from library – stays installed', 'Wieder in die Bibliothek aufnehmen': 'Put back into the library',
    'Scanne Plugins …': 'Scanning plugins …', 'Nichts gefunden.': 'Nothing found.', 'Zurück': 'Back',
    'Tippen zum Suchen · ↑/↓ wählen · Enter lädt · ⇧Enter auf neuer Spur': 'Type to search · ↑/↓ select · Enter loads · ⇧Enter on a new track',
    '– drücke jetzt eine Taste zum Belegen (Esc = Abbrechen)': '– now press a key to assign (Esc = cancel)',
    'Name …': 'Name …', 'Sammlungen': 'Collections', '＋ Neue Sammlung': '＋ New collection', 'Neue Sammlung': 'New collection',
    // ---- keyboard ----
    'Layout': 'Layout', 'Voll · mit Ziffernblock': 'Full · with numpad', 'Ohne Ziffernblock': 'Without numpad', 'MacBook': 'MacBook',
    'Kompakt · nur Buchstaben & Ziffern': 'Compact · letters & digits only', 'Global mit': 'Global with', 'ohne (nur in Live)': 'none (only in Live)',
    'Globale Hotkeys': 'Global hotkeys', 'Live-Tasten zeigen': 'Show Live keys', 'Keine Taste': 'No key',
    'Aufnahme': 'Record', 'Zurück zum Arrangement': 'Back to Arrangement', 'Session-Record': 'Session record', 'Leertaste': 'Space',
    'Start/Stopp': 'Start/stop', 'Zum Anfang': 'To start', 'Scrollen': 'Scroll', 'Löschen': 'Delete', 'Zum Ende': 'To end',
    'Auswahl hoch': 'Selection up', 'Auswahl runter': 'Selection down', 'Nudge zurück': 'Nudge back', 'Nudge vor': 'Nudge forward',
    'Plugin hierher ziehen': 'Drag a plugin here', "So geht's": 'How it works',
    'Karte auf eine Taste ziehen, oder Rechtsklick auf eine Karte → „Taste zuweisen …“ und Taste drücken.': 'Drag a card onto a key, or right-click a card → “Assign key …” and press the key.',
    'Rechtsklick auf eine belegte Taste:': 'Right-click a mapped key:', '„Auf neuer Spur laden“': '“Load on new track”',
    '– dann legt die Taste in Live erst eine neue Spur an (MIDI für Instrumente, Audio für Effekte) und lädt das Plugin dort.':
      '– the key then first creates a new track in Live (MIDI for instruments, audio for effects) and loads the plugin there.',
    'Global:': 'Global:', '⌃⌥⌘ + Taste': '⌃⌥⌘ + key', '– frei – nichts in Live nutzt diese Kombination': '– free – nothing in Live uses this combination',
    '⇧-Klick auf eine Karte lädt ebenfalls auf eine neue Spur.': '⇧-click on a card also loads onto a new track.',
    'Taste drücken …': 'Press a key …',
    // ---- context menu ----
    'In Live laden': 'Load in Live', 'Auf neuer Spur laden': 'Load on new track', 'Unsorted (später zuordnen)': 'Unsorted (assign later)',
    'Mehrere umkategorisieren …': 'Recategorise several …', 'Auswahl aufheben': 'Clear selection', 'Neu aufnehmen': 'Retake picture',
    'Aufnehmen': 'Take picture', '(in Live)': '(in Live)', 'Neu aufnehmen (in Live)': 'Retake picture (in Live)', 'Aufnehmen (in Live)': 'Take picture (in Live)',
    'Eigenes Bild wählen …': 'Choose own picture …', 'Eigenes Bild entfernen': 'Remove own picture', 'Taste zuweisen …': 'Assign key …',
    '★ Zu Favoriten': '★ Add to favourites', '★ Aus Favoriten': '★ Remove from favourites', 'Aus Bibliothek entfernen': 'Remove from library',
    'Bleibt installiert': 'Stays installed', 'Wieder aufnehmen': 'Restore', 'Im Finder zeigen': 'Show in Finder', 'Typ': 'Type',
    'Lösen': 'Unpin', 'Anheften': 'Pin', 'Umbenennen': 'Rename', 'Farbe': 'Colour', 'Sammlung löschen': 'Delete collection',
    'Aus Sammlung entfernen': 'Remove from collection', 'Zu Sammlung': 'Add to collection',
    // ---- toolbar states, toasts ----
    'Stopp': 'Stop', 'Später': 'Later', 'Jetzt aktualisieren': 'Update now', 'Laden wartet, bis es fertig ist': 'Loading waits until it is done',
    'Scanne …': 'Scanning …', 'Stopp (AU/VST3 …)': 'Stop (AU/VST3 …)', 'Stopp (in Live …)': 'Stop (in Live …)', 'Aufnahme gestoppt.': 'Capture stopped.',
    'Alle Bilder aufgenommen.': 'All pictures taken.', 'AU/VST3 fertig. Für VST2, Stock und Max Live öffnen und erneut starten.': 'AU/VST3 done. For VST2, stock and Max open Live and start again.',
    'Schritt 1/2: AU- und VST3-Plugins werden im Hintergrund fotografiert …': 'Step 1/2: AU and VST3 plugins are photographed in the background …',
    'Schritt 2/2: VST2, Stock und Max werden in Live aufgenommen – Live vorne lassen.': 'Step 2/2: VST2, stock and Max are captured in Live – keep Live in front.',
    'Nehme Plugin-Ansichten im Hintergrund auf – das dauert eine Weile.': 'Taking plugin pictures in the background – this takes a while.',
    '⌘-Klick auf weitere Karten zum Auswählen, dann Rechtsklick → Kategorie': '⌘-click more cards to select them, then right-click → category',
    'Lädt noch …': 'Still loading …', 'Indexierung läuft – Laden wartet, bis sie fertig ist.': 'Indexing is running – loading waits until it is done.',
    'Plugin nicht gefunden.': 'Plugin not found.', 'Bitte warten, bis Laden/Indexierung fertig ist.': 'Please wait until loading/indexing is done.',
    'Kein Update gefunden.': 'No update found.', 'Nur auf macOS verfügbar.': 'Only available on macOS.', 'Starte zuerst Ableton Live.': 'Start Ableton Live first.',
    'Die Indexierung läuft bereits.': 'Indexing is already running.', 'Ableton Live läuft nicht.': 'Ableton Live is not running.',
    'Bildschirmaufnahme nicht erlaubt (Systemeinstellungen → Datenschutz & Sicherheit).': 'Screen recording not allowed (System Settings → Privacy & Security).',
    'Ableton Live läuft nicht mehr – Indexierung gestoppt.': 'Ableton Live is no longer running – indexing stopped.',
    'Bedienungshilfen-Zugriff fehlt (Systemeinstellungen → Datenschutz → Bedienungshilfen).': 'Accessibility access missing (System Settings → Privacy → Accessibility).',
    'Das Live-Skript wurde aktualisiert – Live bei Gelegenheit neu starten, damit es die neue Fassung lädt.': 'The Live script was updated – restart Live when convenient so it loads the new version.',
    'Das ist keine Sicherung des Plugin Organizers.': 'This is not a Plugin Organizer backup.', 'Nur in der installierten App möglich.': 'Only possible in the installed app.',
    'Sicherung abgebrochen – nichts gelöscht.': 'Backup cancelled – nothing deleted.',
    // ---- update bar ----
    'Update installiert – die App startet neu …': 'Update installed – the app restarts …', 'Du hast die neueste Version.': 'You have the latest version.',
    'Suche …': 'Searching …', 'Nach einer neuen Version suchen.': 'Look for a new version.',
    // ---- live script guide ----
    'Live-Skript einrichten': 'Set up the Live script',
    'Mit dem Live-Skript lädt der Plugin Organizer Plugins, Devices, Racks und Presets': 'With the Live script, Plugin Organizer loads plugins, devices, racks and presets',
    'direkt über Ableton Live': 'directly through Ableton Live',
    '– in Sekundenbruchteilen und genau das richtige Gerät. Das Skript ist schon installiert; Live muss es nur einmal aktivieren:': '– in a fraction of a second and always the right device. The script is already installed; Live just needs to activate it once:',
    'Live neu starten.': 'Restart Live.', 'Set speichern, Live beenden und wieder öffnen – Live liest Skripte nur beim Start ein.': 'Save your set, quit Live and open it again – Live only reads scripts at startup.',
    'Einstellungen öffnen:': 'Open the settings:', 'in Live': 'in Live', '(Windows:': '(Windows:', 'Strg ,': 'Ctrl ,', ') → Reiter': ') → tab',
    '„Link, Tempo & MIDI“': '“Link, Tempo & MIDI”', 'Control Surface wählen:': 'Choose the control surface:',
    'in einer freien Zeile unter „Control Surface“': 'in a free row under “Control Surface”', '„Frequenzbetrieb“': '“Frequenzbetrieb”',
    'auswählen. Input und Output bleiben auf': 'select. Input and output stay at', '„None“': '“None”', 'Fertig.': 'Done.',
    'Einstellungen schließen – hier erscheint dann ✓.': 'Close the settings – a ✓ appears here.', 'Warte auf Live …': 'Waiting for Live …',
    'Nicht mehr automatisch anzeigen': "Don't show automatically again", 'Erneut prüfen': 'Check again',
    '✓ Live-Skript ist aktiv – Laden läuft jetzt direkt über Live.': '✓ The Live script is active – loading now goes straight through Live.',
    'Skript fehlt in der User Library – wird jetzt installiert …': 'Script missing from the User Library – installing it now …',
    'Live läuft, das Skript ist aber noch nicht aktiv (Schritte 1–3).': 'Live is running, but the script is not active yet (steps 1–3).',
    'Live ist nicht geöffnet – bitte Live starten.': 'Live is not open – please start Live.',
    // ---- settings ----
    'Einstellungen': 'Settings', 'Fertig': 'Done', 'Immer im Vordergrund': 'Always on top', 'Die App bleibt über Live sichtbar, auch im Vollbild.': 'The app stays visible above Live, even in full screen.',
    'Ein-/Ausblenden-Taste': 'Show/hide key', 'Global: blendet die App aus und holt sie wieder nach vorne. Klick ins Feld, dann Taste(n) drücken.': 'Global: hides the app and brings it back. Click the field, then press the key(s).',
    'Nach dem Laden ausblenden': 'Hide after loading', 'Sobald ein Plugin in Live geladen ist, verschwindet die App und du bist direkt in Live.': 'As soon as a plugin is loaded in Live, the app disappears and you are right back in Live.',
    'Beim Anmelden starten': 'Start at login', 'Startet den Plugin Organizer automatisch, wenn du dich am Computer anmeldest.': 'Starts Plugin Organizer automatically when you log in to your computer.',
    'Sprache': 'Language', 'Sprache der App. „Automatisch“ folgt der Systemsprache.': 'Language of the app. “Automatic” follows the system language.',
    'Automatisch': 'Automatic', 'Deutsch': 'Deutsch', 'English': 'English',
    'Live-Skript': 'Live script', 'Prüfen': 'Check', 'Anleitung': 'Guide', 'Installieren': 'Install', 'Prüfe …': 'Checking …',
    '✓ Aktiv – Plugins werden direkt über Live geladen (schnell und exakt).': '✓ Active – plugins are loaded directly through Live (fast and exact).',
    'Nicht installiert. „Installieren“ kopiert es in deine User Library.': 'Not installed. “Install” copies it into your User Library.',
    'Installiert, aber in Live nicht aktiv. Live neu starten, dann Einstellungen → Link, Tempo & MIDI → Control Surface „Frequenzbetrieb“ wählen (Input/Output: None). Bis dahin lädt die App über die Suche.':
      'Installed, but not active in Live. Restart Live, then Settings → Link, Tempo & MIDI → Control Surface “Frequenzbetrieb” (input/output: None). Until then the app loads via the search.',
    'Aktiv, aber Live nutzt noch die alte Fassung des Skripts. Live einmal neu starten, damit die neue geladen wird.': 'Active, but Live still uses the old version of the script. Restart Live once to load the new one.',
    'Keine User Library von Ableton Live gefunden – ist Live installiert und einmal gestartet worden?': 'No Ableton Live User Library found – is Live installed and has it been started once?',
    'Neue Plugins automatisch finden': 'Find new plugins automatically',
    'Beobachtet die Plugin-Ordner und scannt von selbst neu, wenn du etwas installierst oder löschst. Neue Plugins bekommen ein „NEU“.': 'Watches the plugin folders and rescans by itself when you install or delete something. New plugins get a “NEW” badge.',
    'Sichern & übertragen': 'Back up & transfer',
    'Tasten, Favoriten, Sammlungen, Kategorien, eigene Bilder, Plugin-Bilder und Einstellungen in einer Datei – zum Sichern oder für einen anderen Rechner.': 'Keys, favourites, collections, categories, own pictures, plugin pictures and settings in one file – as a backup or for another computer.',
    'Sichern …': 'Back up …', 'Wiederherstellen …': 'Restore …', 'Sichere … (die Plugin-Bilder brauchen einen Moment)': 'Backing up … (the plugin pictures take a moment)',
    'Stelle wieder her …': 'Restoring …', 'Abgebrochen.': 'Cancelled.', 'Werkseinstellungen': 'Factory reset',
    'Löscht Plugin-Liste, alle Bilder, Tasten, Sammlungen und Einstellungen und startet neu wie frisch installiert. Mit Sicherheitsabfrage, auf Wunsch vorher Sicherung.': 'Deletes the plugin list, all pictures, keys, collections and settings and restarts like a fresh install. Asks first, optionally makes a backup.',
    'Zurücksetzen …': 'Reset …', 'Automatisch nach Updates suchen': 'Check for updates automatically',
    'Beim Start und alle 6 Stunden auf GitHub nachsehen. Installiert wird nur, wenn du es bestätigst – deine Bibliothek, Bilder und Tasten bleiben erhalten.': 'Looks on GitHub at startup and every 6 hours. Installs only when you confirm – your library, pictures and keys are kept.',
    'Version': 'Version', 'Jetzt prüfen': 'Check now', 'Stream Deck': 'Stream Deck', 'Herunterladen': 'Download',
    'Plugins mit Bild auf den Tasten, ein Druck lädt sie in Live. Stream-Deck-Plugin herunterladen und per Doppelklick installieren, dann in der Elgato-Software die Aktion „Plugin laden“ (Kategorie Frequenzbetrieb) auf eine Taste ziehen.':
      'Plugins with pictures on the keys, one press loads them in Live. Download the Stream Deck plugin and double-click to install, then drag the “Plugin laden” action (category Frequenzbetrieb) onto a key in the Elgato software.',
    'Ein kostenloses Open-Source-Projekt von': 'A free open-source project by', '– frei nutzbar unter der AGPL-3.0.': '– free to use under the AGPL-3.0.',
    'Wenn dir das Programm hilft, freuen wir uns über eine Spende für die Vereinsarbeit.': 'If the program helps you, we appreciate a donation for our association’s work.',
    'Fehler melden': 'Report a bug',
    // ---- health ----
    'Analysiere Bibliothek …': 'Analysing library …', 'kannst du zurückholen': 'you can reclaim', 'Deine Sessions': 'Your sessions',
    'Der Plugin Organizer liest deine Ableton-Live-Sets: welche Plugins darin stecken, was auf diesem Rechner fehlt und was nie vorkommt. Füge die Ordner hinzu, in denen deine Projekte liegen.':
      'Plugin Organizer reads your Ableton Live sets: which plugins they use, what is missing on this computer and what never appears. Add the folders that hold your projects.',
    '+ Ordner hinzufügen': '+ Add folder', 'Live-Sets ·': 'Live sets ·', 'verschiedene Plugins benutzt ·': 'different plugins used ·',
    'Fehlende anzeigen': 'Show missing', 'Meistbenutzt': 'Most used', 'Laden nicht': "Won't load", 'Plugins brauchen Rosetta, das Apple abschafft': 'plugins need Rosetta, which Apple is phasing out',
    'Nie geladen': 'Never loaded', 'VST2-Kopien': 'VST2 copies', 'Entfernen': 'Remove', '← Zurück': '← Back',
    'Fehlen auf diesem Rechner': 'Missing on this computer', 'Meistbenutzt in deinen Sets': 'Most used in your sets', 'Kommen in keinem Live-Set vor': "Don't appear in any Live set",
    'Nur als Intel-Version vorhanden': 'Intel-only', 'Nie aus dem Plugin Organizer geladen': 'Never loaded from Plugin Organizer', 'VST2-Versionen mit VST3-Gegenstück': 'VST2 versions with a VST3 counterpart',
    // ---- monitor window ----
    'Stoppen und schließen': 'Stop and close', 'Starte …': 'Starting …', 'Noch kein Bild': 'No picture yet', 'kein Bild': 'no picture',
    // ---- types (used as words inside other strings) ----
    'Ist eigentlich:': 'Actually:', 'Bild': 'Picture', 'Klick lädt, Rechtsklick für Optionen': 'click loads, right-click for options',
    'Wenn dir das Programm hilft, freuen wir uns über eine Spende für die Vereinsarbeit.': 'If the program helps you, we appreciate a donation for our association’s work.',
    '– frei nutzbar unter der AGPL-3.0. Wenn dir das Programm hilft, freuen wir uns über eine Spende für die Vereinsarbeit.': '– free to use under the AGPL-3.0. If the program helps you, we appreciate a donation for our association’s work.', 'NEU': 'NEW', 'Live': 'Live',
  };

  // Dynamic texts: [German pattern, English replacement]. "$T1" = translate group 1 as well.
  const PATTERNS = [
    [/^Alle (\d+) zeigen →$/, 'Show all $1 →'], [/^in Live: (.+)$/, (m, a) => `in Live: ${tr(a)}`],
    [/^(.+) \(auf neuer Spur\)$/, '$1 (on new track)'], [/^Alle (\d+) anzeigen$/, 'Show all $1'],
    [/^(\d+) Tasten? belegt$/, (m, n) => `${n} key${n === '1' ? '' : 's'} mapped`],
    [/^Ist eigentlich: (.+)$/, (m, a) => `Actually: ${tr(a)}`],
    [/^Lade (.+?) auf neue Spur …$/, 'Loading $1 on a new track …'], [/^Lade (.+?) …$/, 'Loading $1 …'],
    [/^Nehme (.+) in Live auf …$/, 'Capturing $1 in Live …'], [/^Nehme (.+) auf …$/, 'Capturing $1 …'],
    [/^Nehme auf: (.+)$/, 'Capturing: $1'],
    [/^„(.+)“ wurde in Lives Browser nicht gefunden\.$/, '“$1” was not found in Live’s browser.'],
    [/^Sammlung „(.+)“ angelegt – Karten hierher ziehen$/, 'Collection “$1” created – drag cards here'],
    [/^„(.+)“ gelöscht – die Plugins bleiben erhalten$/, '“$1” deleted – the plugins are kept'],
    [/^Globale Hotkeys jetzt: (.+) \+ Taste$/, 'Global hotkeys now: $1 + key'],
    [/^(.+): (.+) wird auf einer neuen Spur geladen$/, '$1: $2 now loads on a new track'],
    [/^(.+): (.+) wird auf der ausgewählten Spur geladen$/, '$1: $2 now loads on the selected track'],
    [/^Stopp \(AU\/VST3 (\d+)\/(\d+)\)$/, 'Stop (AU/VST3 $1/$2)'],
    [/^Indexiere in Ableton: (.+)$/, 'Indexing in Ableton: $1'], [/^Indexierung fertig: (\d+) von (\d+)$/, 'Indexing done: $1 of $2'],
    [/^(\d+) Plugins\/Devices ohne Bild werden in Ableton aufgenommen …$/, '$1 plugins/devices without a picture are being captured in Ableton …'],
    [/^Scanne Plugins … (.+)$/, 'Scanning plugins … $1'], [/^Analysiere Bibliothek … (.+)$/, 'Analysing library … $1'],
    [/^Gesichert: (.+)$/, 'Backed up: $1'], [/^Sichern fehlgeschlagen: (.+)$/, 'Backup failed: $1'],
    [/^Wiederherstellen fehlgeschlagen: (.+)$/, 'Restore failed: $1'],
    [/^Plugin-Ordner geändert – (.+)$/, (m, a) => `Plugin folders changed – ${a.replace(/(\d+) neu/, '$1 new').replace(/(\d+) entfernt/, '$1 removed')}`],
    [/^Prüfen fehlgeschlagen: (.+)$/, 'Check failed: $1'], [/^Version (.+) ist verfügbar\.$/, 'Version $1 is available.'],
    [/^Neue Version (.+) verfügbar – die App lädt sie herunter, tauscht sich aus und startet neu\.$/, 'New version $1 available – the app downloads it, replaces itself and restarts.'],
    [/^Update wird geladen … (.+)$/, 'Downloading update … $1'], [/^Update fehlgeschlagen: (.+)$/, 'Update failed: $1'],
    [/^(\d+) Plugins ausgewählt$/, '$1 plugins selected'], [/^Taste (.+) freigeben$/, 'Free key $1'],
    [/^(\d+) fehlen auf diesem Rechner$/, '$1 missing on this computer'],
    [/^(\d+) nie in einem Set \((.+)\)$/, '$1 never in a set ($2)'],
    [/^(\d+) Plugins nie aus dem Plugin Organizer geladen$/, '$1 plugins never loaded from Plugin Organizer'],
    [/^(\d+) Plugins, die du auch als VST3 hast$/, '$1 plugins you also have as VST3'],
    [/^(\d+) Plugins brauchen Rosetta, das Apple abschafft$/, '$1 plugins need Rosetta, which Apple is phasing out'],
    [/^· (.+) Plugins auf diesem (Mac|PC)$/, (m, a, b) => `· ${a} of plugins on this ${b}`],
    [/^Spur (\d+) an\/aus$/, 'Track $1 on/off'], [/^(.+) – kein Bild$/, '$1 – no picture'],
    [/^(\d+) \/ (\d+) · (\d+) ok · (\d+) ohne Bild$/, '$1 / $2 · $3 ok · $4 without picture'],
    [/^Bildschirmaufnahme nicht erlaubt: (.+)$/, 'Screen recording not allowed: System Settings → Privacy & Security → Screen & System Audio Recording → enable Plugin Organizer, then restart the app.'],
    [/^Abgebrochen: (.+)$/, 'Cancelled: $1'],
  ];

  let lang = 'de';
  const cache = new Map();

  // Exact match → pattern → pieces around " · ", " – ", leading ✓/★, trailing ›.
  function tr(s) {
    if (lang !== 'en' || !s) return s;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = m[2].replace(/\s*\n\s*/g, ' ');
    if (!core || !/[A-Za-zÄÖÜäöüß]/.test(core)) return s;
    if (cache.has(core)) return m[1] + cache.get(core) + m[3];
    let out = EN[core];
    if (out === undefined) {
      for (const [re, rep] of PATTERNS) if (re.test(core)) { out = core.replace(re, rep); break; }
    }
    if (out === undefined) {
      const deco = core.match(/^([✓★•✕＋+]\s)?(.+?)(\s›)?$/);
      if (deco && (deco[1] || deco[3]) && EN[deco[2]] !== undefined) out = (deco[1] || '') + EN[deco[2]] + (deco[3] || '');
    }
    if (out === undefined) {
      for (const sep of [' · ', ' – ', ' → ']) {
        if (core.includes(sep)) {
          const parts = core.split(sep).map((p) => tr(p));
          const joined = parts.join(sep);
          if (joined !== core) { out = joined; break; }
        }
      }
    }
    if (out === undefined) out = core;
    cache.set(core, out);
    return m[1] + out + m[3];
  }

  const ATTRS = ['title', 'placeholder'];
  function translateNode(node) {
    if (lang !== 'en') return;
    if (node.nodeType === 3) {
      const v = tr(node.nodeValue);
      if (v !== node.nodeValue) node.nodeValue = v;
      return;
    }
    if (node.nodeType !== 1 || node.closest?.('[data-noi18n]')) return;
    for (const a of ATTRS) {
      const v = node.getAttribute?.(a);
      if (v) { const t = tr(v); if (t !== v) node.setAttribute(a, t); }
    }
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
      else for (const a of ATTRS) { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
    }
  }

  let observer;
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'de';
    document.documentElement.lang = lang;
    if (lang !== 'en') { observer?.disconnect(); return; }
    translateNode(document.body);
    if (!observer) {
      observer = new MutationObserver((list) => {
        for (const r of list) {
          if (r.type === 'characterData') translateNode(r.target);
          else if (r.type === 'attributes') translateNode(r.target);
          else r.addedNodes.forEach(translateNode);
        }
      });
    }
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.I18N = { setLang, t: tr, get lang() { return lang; } };
})();
