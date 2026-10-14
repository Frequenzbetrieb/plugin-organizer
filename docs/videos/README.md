# Demo-Videos / Demo videos

Kurze, stumme Videos der wichtigsten Funktionen für die Homepage – je auf Deutsch (`de/`) und Englisch (`en/`), mit Vorschaubild (`.jpg`).

| Datei | Inhalt | Länge |
|---|---|---|
| `bibliothek.mp4` | Bibliothek mit Bildern, Kategorien, tippfehler-tolerante Suche („valhala“, „proq“) | ~21 s |
| `schnellsuche.mp4` | Schnellsuche über Live (⌃⌥Leertaste): zuletzt geladen, Suche, Auswahl | ~10 s |
| `laden.mp4` | Laden in Live: links die App, rechts Live – EQ Eight auf neuer Spur, dann Compressor und Reverb | ~23 s |
| `ketten.mp4` | Rechtsklick-Menü mit Bewertung, Ketten, Notizen; Kette bearbeiten | ~16 s |
| `handy.mp4` | Fernbedienung auf dem Handy (Hochformat): Effekte → EQ → Plugins, neue Spur, Suche | ~17 s |
| `streamdeck.mp4` | Plugin-Browser auf dem Stream Deck | ~11 s |

## In WordPress einbinden

**Empfohlen:** Videos in die **Mediathek** hochladen und im Beitrag den Block **„Video“** nutzen. In den Block-Einstellungen *Autoplay*, *Schleife*, *Stumm* und *Inline abspielen* einschalten und das passende `.jpg` als Vorschaubild wählen.

**Oder als HTML** (Block „Individuelles HTML“) direkt aus dem GitHub-Projekt – über das kostenlose CDN jsDelivr, das die Dateien mit dem richtigen Videotyp ausliefert:

```html
<video autoplay muted loop playsinline preload="metadata" style="width:100%;border-radius:10px"
  poster="https://cdn.jsdelivr.net/gh/Frequenzbetrieb/plugin-organizer@main/docs/videos/de/schnellsuche.jpg">
  <source src="https://cdn.jsdelivr.net/gh/Frequenzbetrieb/plugin-organizer@main/docs/videos/de/schnellsuche.mp4" type="video/mp4">
</video>
```

Für die englische Seite `de/` durch `en/` ersetzen, für ein anderes Video den Dateinamen ändern. Das Handy-Video ist hochkant – dort besser `style="max-width:360px;width:100%;border-radius:10px"`.

## Neu aufnehmen

Die Videos entstehen automatisch aus der App (kein Bildschirm-Mitschnitt): `tools/demo/` spielt die Funktionen mit sichtbarem Mauszeiger vor, nimmt die App-Fenster auf und baut mit ffmpeg die MP4s.

```bash
PO_USERDATA=<Kopie des Datenordners> PO_DEMO=schnellsuche PO_DEMO_LANG=de npx electron .
```

Demos: `bibliothek`, `schnellsuche`, `ketten`, `laden`, `handy` (Live muss für `laden` und den Hintergrund von `schnellsuche` laufen; für `handy` die Fernbedienung in der Kopie einschalten). Das Stream-Deck-Video entsteht aus den Bildern von `streamdeck/test/fake-deck.js`.
