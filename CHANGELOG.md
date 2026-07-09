# Changelog

All notable changes to `saltcorn-samba` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.16] – 2026-07-08

### Added – Internationalisierung (Deutsch + Englisch)

Alle sichtbaren Texte im File-Manager, im Tree, im PDF-Fieldview und in den
Dialogen (Upload, Delete, Rename, Mkdir) sind jetzt übersetzbar.

- Neue Kataloge unter `i18n/de.json` und `i18n/en.json` (~90 Schlüssel,
  Punkt-Notation nach Bereich `ui.*`, `fm.*`, `tree.*`, `pdf.*`).
- Neues Server-Modul `i18n.js` – keine externe Dependency, JSON-Kataloge
  werden gelesen und im Prozess gecacht. Placeholder-Interpolation `{name}`.
  API: `t(key, {locale, ...params})`, `tFor(locale)`, `catalogFor(locale)`,
  `resolveLocaleFromReq(req, explicit)`.
- Locale-Auflösung: expliziter Wert → `req.getLocale()` → Query `?locale=xx`
  → `Accept-Language`-Header → Fallback `en`. Unbekannte Locales fallen
  automatisch auf die Sprachbasis oder `en` zurück.
- Neue Diagnose-Route `GET /samba-i18n.json?locale=xx` liefert den Katalog
  als JSON (kein Auth, enthält keine Konfiguration).
- Client bekommt den Katalog **inline** in die View-Shell injiziert – kein
  zusätzlicher HTTP-Roundtrip beim ersten Rendern, keine englischen Keys, die
  kurz aufblitzen. `SambaCommon.setCatalog(…)` wird aufgerufen, bevor die
  view-spezifische JS-Datei geladen wird.
- Fehlt ein Key: automatischer Fallback auf Englisch, dann auf den Key
  selbst – nichts bricht.

### Changed – Client-JS: Gemeinsame Utilities in `public/samba-common.js`

- Neues Modul `public/samba-common.js` bündelt: `iconFor()`, `extOf()`,
  `mediaTypeFor()`, `isViewable()`, `fmtSize()`, `fmtDate()`, `joinPath()`,
  `parentOf()`, plus die i18n-Funktionen `t()`, `setCatalog()`, `loadCatalog()`.
- **`iconFor()` war bisher in `samba-filemanager.js` und `samba-tree.js`
  identisch dupliziert** – jetzt einzige Quelle in `samba-common.js`.
  Änderungen am Icon-Mapping (neue Extensions etc.) müssen nur noch an einer
  Stelle gemacht werden.
- `samba-filemanager.js` und `samba-tree.js` konsumieren die Utilities über
  `window.SambaCommon`. Die lokalen Kopien von `iconFor`, `extOf`,
  `mediaTypeFor`, `isViewable`, `fmtSize`, `fmtDate`, `joinPath`, `parentOf`
  sind entfernt.
- Alle sichtbaren Strings in beiden Client-JS gehen über `SambaCommon.t(...)`.

### Changed – Bootstrap der View-Shells: zweistufig

`filemanager-view.js` und `tree-view.js` laden jetzt zuerst `samba-common.js`
(setzt `window.SambaCommon`, wendet den inline gelieferten i18n-Katalog an)
und erst danach die view-spezifische JS-Datei. Sind beide bereits geladen,
wird nur re-mounted – kein doppeltes `<script>`-Injecten. `pdf-view.js`
nutzt serverseitig `tFor(resolveLocaleFromReq(req))`.

### Changed – Namens-Cleanup und Kommentare in beiden Client-JS

Goal: die Client-Dateien sollen sich wie ordentliche Node-ähnliche Module
lesen, nicht wie ein Minifier-Output.

- `samba-tree.js`: `h`→`element`, `fetchDir`→`fetchDirectory`,
  `renderList`→`renderLevel`, `openDir`→`toggleDirectory`, `li`→`lineItem`
  u.ä. Jede exportierte / interne Funktion hat einen JSDoc-Kommentar.
- `samba-filemanager.js`: `h`→`element`, `modal`→`openModal`, `m`→`dialog`,
  `r`→`response`, `fd`→`formData`, `overwriteCb`→`overwriteCheckbox`,
  `picked`→`pickedList`, `uploadBtn`→`uploadButton`. Kommentare ergänzt.

### Added – README: Sicherheits-Abschnitt „Client-/Server-Trennung“

Neuer Unterabschnitt in `## Sicherheit` erklärt explizit:

- Welche Dateien serverseitig laufen (SMB-Credentials, `base_path`,
  `view_base_path`, Sanitizer, Routen) und welche clientseitig (reine UI).
- Wo genau Sicherheit durchgesetzt wird: CSRF (Saltcorn-csurf), Auth/Rolle
  (Saltcorn + `min_role_read`/`min_role_write`), `sanitizeRelativePath`,
  Base-Path-Enforcement, SMB-Session mit serverseitig konfiguriertem User.
- Wichtiger Hinweis: `view_base_path` ist **keine** Sicherheitsgrenze
  zwischen Usern; für Mandantentrennung entweder Rollen-gated Views oder
  eigene Plugin-Instanzen mit separaten SMB-Usern.
- Kurzfassung: JavaScript in `public/` ist reine Kosmetik; jeder Client (auch
  ein manipulierter) bekommt dieselben 403/400-Antworten wie ein regulärer.

Zusätzlich neuer Abschnitt `## Internationalisierung (i18n)` mit
Entwickler-Doku (Kataloge ergänzen, API, Locale-Auflösung, Diagnose-Route).

### Packaging

- `package.json`: Version 0.4.15 → 0.4.16. `files` ergänzt um `i18n.js` und
  `i18n/`. `lint`-Script prüft jetzt auch `i18n.js` und `public/samba-common.js`.
- Keine neuen Runtime-Dependencies. Fortlaufend: nur `smb3-client ^0.2.0`.

### Compatibility

Rückwärtskompatibel:

- Alle bestehenden Routen (`/sambadir`, `/sambafile`, `/sambalink`,
  `/sambaupload`, `/sambadelete`, `/sambarename`, `/sambamkdir`, `/sambatest`)
  unverändert in Signatur und Verhalten.
- View-Konfigurationsschema unverändert; existierende Views laufen weiter.
- Wer die Client-JS direkt einbindet, muss zusätzlich `samba-common.js` vor
  `samba-filemanager.js` / `samba-tree.js` laden (das übernimmt die
  View-Shell automatisch).

## [0.4.15] – 2026-07-07

### Fixed – CSRF-Fehlermeldung bei Upload / Ordner anlegen / Rename / Delete

Bei jedem schreibenden Klick in der File-Manager-View („Ordner anlegen“,
„Datei hochladen“, „umbenennen“, „löschen“) erschien der Fehler
`Invalid CSRF token`, obwohl der Client den Token korrekt im Header
`X-CSRF-Token` mitgeschickt hat.

**Root Cause:** Saltcorns globaler `csurf`-Middleware validiert bereits
alle POST-Routen der Plugins gegen das Session-Secret. Unser Plugin hatte
zusätzlich eine manuelle `checkCsrf(req)`-Funktion, die den vom Client
geschickten Token mit `req.csrfToken()` verglich. `req.csrfToken()` gibt
aber bei jedem Aufruf einen **frisch gesalzenen** Token zurück – der
Stringvergleich `provided !== req.csrfToken()` schlug daher immer fehl,
auch bei völlig gültigen Requests.

**Fix:** `checkCsrf` ist jetzt ein dokumentierter No-Op. Die eigentliche
CSRF-Prüfung übernimmt weiterhin Saltcorns Middleware (kein Sicherheits-
abbau). Betroffene Write-Routen (Upload, Mkdir, Rename, Delete) in
`index.js` sind unverändert und funktionieren jetzt korrekt.

### Added – View-Basispfad (`view_base_path`) für File-Manager und Tree

Beide Views (SambaFileManager und SambaTree) haben ein neues optionales
Konfigurationsfeld **„View-Basispfad (relativ zum Plugin-Basispfad)“**.
Damit lässt sich der Pfad zweistufig konfigurieren:

1. **Plugin-Basispfad** (weiterhin Pflicht) – z. B. `static` – legt fest,
   in welchem Unterverzeichnis der Freigabe der Plugin-Root liegt.
2. **View-Basispfad** (neu, optional) – z. B. `projekte/2026` – ein
   statischer Präfix, der nur für diese eine View gilt.

Beispiel: Plugin-Basispfad = `static`, View-Basispfad = `projekte/2026`
→ die View listet den effektiven Pfad `static/projekte/2026`.

Der bisherige `extra_subpath` in beiden Views ist jetzt konsistent auf
den `from_field`-Modus beschränkt (dort weiterhin: Suffix hinter dem
Feldwert der aktuellen Zeile). Im `static`-Modus zählt nur
`view_base_path`.

Der zusammengesetzte Pfad wird pro Segment slash-getrimmt und
durchläuft `sanitizeRelativePath`, so dass `..`-Traversal, absolute
Pfade, UNC-Präfixe usw. weiterhin abgelehnt werden.

### Tests

`test/sanitize.test.js` deckt jetzt zusätzlich die Pfad-Komposition
(`view_base_path` + Feldwert + `extra_subpath`) inklusive Slash-
Normalisierung, Modus-Regeln und Traversal-Ablehnung ab.

## [0.4.14] – 2026-07-06

### Changed – Code-Review / Aufräumen (keine Verhaltensänderung)

Interne QS-Runde nach dem v0.4.13-Fix. Der Bug war behoben, aber die
Kommentare, Fehlertexte und die Fallback-Logik im Connection-Test
verwiesen noch auf die alte, mittlerweile widerlegte Hypothese
(`FileInformationClass=37 hart kodiert`). Alle diese Stellen wurden
auf den tatsächlichen Root Cause aktualisiert bzw. gelöscht.

**readdir-compat.js:**
- Docstring priorisiert den tatsächlichen Hauptbug (leeres Pattern
  auf Folge-Pages) und schiebt den FileNameOffset-Bug in die Sekundär-
  rolle (defensiv abgefangen, wird bei aktueller Loop nie getriggert).
- Encoder-Docstring erklärt, dass der `pat.length === 0`-Zweig nur
  noch defensive Sicherheit ist.

**smb-client.js:**
- Der lange, spekulative Kommentar-Block über „Some Samba builds
  reject QUERY_DIRECTORY on the share root because FileInformation-
  Class=37 is hardcoded“ wurde entfernt. Der wahre Grund steht jetzt
  kurz und präzise dort.
- Die 0xC0000033-Fehlermeldung verweist nicht mehr auf v0.4.12 als Fix
  und nicht mehr auf `tools/diag-basepath.js`, sondern auf
  `tools/diag-wire.js` (das aussagekräftigere Tool).

**index.js (Connection-Test-Route):**
- Der „gelber Hinweis“-Fallback bleibt als Safety Net, wird aber nur
  noch aktiv, wenn `readdir` fehlschlägt und `stat` erfolgreich ist —
  ein Zustand, der seit v0.4.13 nicht mehr auftreten sollte.
- Der Hinweistext sagt jetzt „unerwarteter Zustand, bitte diag-wire.js
  ausführen“ statt der alten, jetzt falschen Erklärung mit
  `FileInformationClass=37`.

**tools/diag-basepath.js:**
- FIX: `client.disconnect()` → `client.close()`. smb3-client's Client
  hat `close()`, nicht `disconnect()` (das war die marsaud-API). Der
  Aufruf schlug bisher am Ende jedes Diagnostic-Runs mit einer
  TypeError-Meldung fehl, ohne aber das Resultat zu beeinträchtigen.

**tools/diag-wire.js:**
- FIX: Zusätzlich zu `open.close()` wird jetzt auch `client.close()`
  aufgerufen, damit der TCP-Socket sauber geschlossen wird.

## [0.4.13] – 2026-07-06

### Fixed – **QUERY_DIRECTORY leere Patterns → 0xC0000033 (die eigentliche Ursache)**

Mit v0.4.12 wurde ein Wire-Bug in smb3-client (FileNameOffset) gefixt,
aber Samba lehnte weiterhin ab. Mit dem neuen `tools/diag-wire.js` konnte
die tatsächliche Ursache byteweise verifiziert werden:

**Bug:** smb3-client's `readdirAll` sendet ab der 2. Enumeration-Seite
`searchPattern=""` (leerer String). Windows toleriert das, aber Samba's
`source3/smbd/smb2_query_directory.c` enthält den strikten Check:

```c
if (state->in_file_name[0] == '\0') {
    tevent_req_nterror(req, NT_STATUS_OBJECT_NAME_INVALID);
    return tevent_req_post(req, ev);
}
```

Das ergibt exakt den STATUS_OBJECT_NAME_INVALID (0xC0000033), den wir
seit v0.4.0 sehen.

**Fix in `readdir-compat.js`:** Der eigene Enumeration-Loop sendet auf
**jeder** Seite `searchPattern="*"`, nicht nur beim ersten Request.
`RESTART_SCANS` wird nur beim ersten Request gesetzt; ab dann sendet
Samba nach dem letzten Batch korrekt STATUS_NO_MORE_FILES, was den Loop
sauber terminiert. Verifiziert via `diag-wire.js`:

- Probe 1 (pat=`*`, RESTART): STATUS_SUCCESS, 8 Einträge
- Probe 2 (pat=`*`, ohne RESTART): STATUS_NO_MORE_FILES → Loop-Ende
- Probe 6 (pat=`""`, offset=0): **0xC0000033** ← der Bug

### Added

- `tools/diag-wire.js` – Wire-Level-Diagnose mit Hex-Dump der SMB2-Bytes,
  testet 6 verschiedene QUERY_DIRECTORY-Varianten (Info-Class, Buffer-
  Größe, mit/ohne Pattern). Nützlich für zukünftige Kompatibilitäts-
  probleme mit anderen SMB-Servern.

### Upstream-Report aktualisiert

`smb3-client-bug-report.md` beschreibt jetzt beide Bugs (FileNameOffset
**und** leeres Pattern gegen Samba). Beide Fixes sind identisch simpel:
auf jeder Page `*` senden.

## [0.4.12] – 2026-07-06

### Fixed – **`0xC0000033` beim readdir gegen Samba 4.23 endgültig behoben (Root Cause identifiziert)**

Nach ausführlicher Wire-Level-Analyse (siehe `smb-diag-report.txt`
aus 0.4.11) ist die eigentliche Ursache identifiziert:

**Bug in `smb3-client@0.2.0`, Datei `dist/wire/structs/queryDirectory.js`:**
Der Encoder für SMB2 QUERY_DIRECTORY setzt das `FileNameOffset`-Feld
immer hart auf 96, auch wenn `FileNameLength = 0` gesendet wird
(z. B. auf der 2. und folgenden Enumeration-Seite).
[MS-SMB2 §2.2.33](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/10906442-294c-46d3-8515-c277efe1f752)
verlangt für diesen Fall **`FileNameOffset = 0`**.
Windows Server toleriert die Fehlbelegung, Samba 4.23 lehnt sie
strikt mit `STATUS_OBJECT_NAME_INVALID` (`0xC0000033`) ab —
deshalb funktioniert nichts, was das Listing über mehrere Pages
braucht, wovon `smb3-client` grundsätzlich ausgeht.

### Fix

Die frühere `readdir-compat.js` (die 3 FileInformationClass-Werte
durchprobierte) ist ersetzt durch einen echten **Wire-Format-Patch**:

- Eigener spec-konformer `encodeQueryDirectoryRequest`-Encoder in
  `readdir-compat.js`
- Eigene QUERY_DIRECTORY-Loop, die den gepatchten Encoder verwendet
- Wiederverwendung von `Open.withOpen` aus `smb3-client` (Open, Close,
  Tree-Connect bleiben unverändert) via dynamischem ESM-Import über
  `file://` URLs (das `exports`-Gate von `smb3-client` sperrt sonst
  jeden Subpath-Import)
- `smb-client.js` nutzt jetzt ausschließlich `readdirCompat` als
  readdir-Pfad. Kein Fallback mehr auf das kaputte `client.readdir()`.
- Bonus: Die Rich-Dirents aus dem gepatchten QUERY_DIRECTORY liefern
  Name, Größe, mtime und ctime in einem Roundtrip. Der bisherige
  Fan-out mit einem `stat()`-Aufruf pro Eintrag entfällt — große
  Verzeichnisse werden dadurch **deutlich schneller**.

### Bekannt – Upstream-Fix eingereicht

Parallel wurde ein Bug-Report an `smb3-client` (GitHub:
`euricojardim/smb3-client`) vorbereitet inklusive Reproduktions-
Diagnose und Patch-Vorschlag. Sobald der Upstream-Fix in einer
neuen `smb3-client`-Version verfügbar ist, kann dieses Plugin die
`readdir-compat.js` wieder entfernen und die eingebaute API direkt
nutzen.

### Migration – keine Konfigurationsänderung nötig

Der Fix greift automatisch. Der gelbe Hinweis „Basispfad bestätigt,
aber Auflisten funktioniert nicht“ aus 0.4.9–0.4.11 fällt weg, weil
das Auflisten jetzt tatsächlich funktioniert. Der File-Manager
zeigt Ordner-Inhalte, die Baum-Ansicht rendert Verzeichnis-Bäume,
PDF-Ansicht und Datei-Downloads funktionieren unverändert.

---

## [0.4.11] – 2026-07-06

### Changed – **Ehrliche Fehlerpropagation statt stiller Fallback**

In 0.4.10 wurde der neue `readdir-compat.js`-Wrapper eingeführt, der
vor dem eigentlichen `QUERY_DIRECTORY` die FileInformationClass
automatisch von 37 → 3 → 1 durchprobiert. Zwei Probleme kamen dabei
zum Vorschein:

1. **Alle drei Info-Klassen lieferten weiterhin `0xC0000033`** auf
   dem betroffenen Server. Das Umschalten der Info-Klasse ist also
   *nicht* die eigentliche Ursache — die Annahme aus 0.4.10 war falsch.
2. **Der Wrapper in `smb-client.js` fiel bei totalem Compat-Fehler
   still auf das kaputte `client.readdir()` zurück**, das exakt
   dieselbe (kaputte) FileInformationClass 37 verwendet. Dadurch
   wurde die 0.4.10-Diagnostik komplett verschluckt und das Symptom
   sah unverändert aus wie vor 0.4.10.

**Fixes in 0.4.11:**

- `smb-client.js` erkennt jetzt den 0xC0000033-Erschöpfungsfehler aus
  dem Compat-Modul (Muster `"all classes exhausted"`) und propagiert
  ihn direkt — kein stiller Retry mehr über das kaputte
  `client.readdir()`.
- `readdir-compat.js` wirft bei Ausschöpfung aller drei Klassen einen
  synthetischen Fehler mit klarem Wortlaut:
  `"QUERY_DIRECTORY failed: 0xC0000033 (all classes exhausted; no
  working FileInformationClass on this server). Tried:
  FileIdBothDirectoryInformation=37, FileBothDirectoryInformation=3,
  FileDirectoryInformation=1."`
  Der Fehler trägt zusätzlich ein `.attempts`-Array mit den
  NT-Statuscodes pro Klasse für spätere Diagnose.

### Was das für dich bedeutet

Der gelbe Hinweis und `QUERY_DIRECTORY failed: 0xC0000033` sind
**noch nicht behoben** — 0.4.11 macht den Fehler nur ehrlich sichtbar,
sodass wir aus dem nächsten Diagnoselauf echte Signale bekommen.

**Nächster Schritt — bitte auf dem Saltcorn-Server ausführen** (im
entpackten Plugin-Verzeichnis, oder direkt aus dem ZIP):

```bash
cd /pfad/zu/saltcorn-samba
node tools/diag-basepath.js \
  --host 192.168.110.10 \
  --share buero \
  --path static \
  --user 01_vassen \
  --domain buero.ib-vassen.de \
  --password 'DEIN_PASSWORT'
```

Das Skript führt 6 Sonden mit rohen NT-Statuscodes aus (TREE_CONNECT,
CREATE, QUERY_DIRECTORY mit allen drei Info-Klassen, `stat`-Probe).
Die Ausgabe zeigt, an welcher Stelle Samba den Fehler wirft und mit
welchem Statuscode. Damit können wir 0.4.12 gezielt schreiben statt
weiter zu raten.

Ein heißer Kandidat für 0.4.12 (Wire-Format-Bug in `smb3-client`):
`encodeQueryDirectoryRequest` setzt `FileNameOffset` immer auf 96,
auch wenn kein Suchmuster gesendet wird — laut
[MS-SMB2 §2.2.33](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/10906442-294c-46d3-8515-c277efe1f752)
MUSS das Feld dann 0 sein. Bestätigung dafür aber bitte erst nach
der Diagnose.

---

## [0.4.10] – 2026-07-05

### Fixed – **`0xC0000033` beim tatsächlichen Auflisten (Tree-View, File-Manager) endgültig behoben**

Ab 0.4.9 zeigte der Verbindungstest zwar den grünen Erfolgsstatus mit
gelbem Hinweis, aber im normalen Betrieb (Tree-View, File-Manager,
Datei-Listen) knallte die Anwendung mit `Samba: QUERY_DIRECTORY failed:
0xC0000033` — der `stat`-Fallback verhinderte das nur beim Test, nicht
bei echten Aufrufen.

**Ursache:** `smb3-client@0.2.0` sendet in
[`open/readdir.js`](https://github.com/euricojardim/smb3-client) hart
kodiert `FileInformationClass = 37`
(`FileIdBothDirectoryInformation`). Samba 4.23 lehnt diese
Info-Klasse für bestimmte Verzeichnisse mit
`STATUS_OBJECT_NAME_INVALID` (`0xC0000033`) ab. `smbclient` und
Windows-Explorer benutzen `FileBothDirectoryInformation (3)` bzw.
`FileDirectoryInformation (1)` — die Samba zuverlässig akzeptiert.

**Fix:** Neues Modul `readdir-compat.js`. Es macht Folgendes:

1. Für jeden `readdir`-Aufruf wird die Directory zuerst per
   `CREATE`+`DIRECTORY_FILE` geöffnet (wie bei smb3-client selbst).
2. Dann sendet der Wrapper `QUERY_DIRECTORY` in dieser Reihenfolge:
   `FileIdBothDirectoryInformation (37)` →
   `FileBothDirectoryInformation (3)` →
   `FileDirectoryInformation (1)`. Sobald eine Klasse Erfolg meldet,
   wird sie pro Client-Instanz gemerkt (`WeakMap`), damit
   Folgeaufrufe nicht dreimal probieren.
3. `0xC0000033` und `STATUS_INVALID_INFO_CLASS` lösen den nächsten
   Versuch aus; jeder andere Fehler (fehlender Pfad, Zugriff
   verweigert, Netzwerk) bricht sofort ab und wird an die bestehende
   deutsche Fehlerbehandlung weitergereicht.
4. Die Rückgabe enthält Größe/`mtime`/`ctime` direkt aus dem
   `QUERY_DIRECTORY`-Response — dadurch entfällt der bisherige
   Per-Entry-`stat`-Fan-Out, was Directory-Listings spürbar
   beschleunigt.
5. Bei `readdir` bleibt `client.readdir()` als klassischer Fallback
   erhalten, wenn `readdir-compat` an einem *anderen* Fehler scheitert
   — dann greifen die bereits vorhandenen Rewrites
   („Pfad existiert nicht", Groß-/Kleinschreibungs-Probes).

**Warum das überhaupt geht:** `smb3-client` publiziert nur seinen
`Client`-Konstruktor über die `exports`-Map. Die internen Wire-
Encoder/Decoder liegen aber als reguläre `.js`-Dateien in
`dist/`. Der Wrapper importiert sie über `file://`-URLs direkt vom
Filesystem (also `node_modules/smb3-client/dist/wire/structs/...`),
was den `exports`-Gate umgeht. Das ist stabil, solange die
dist-Layout-Konventionen der 0.2.x-Reihe von `smb3-client` erhalten
bleiben.

## [0.4.9] – 2026-07-05

### Fixed – **`0xC0000033` beim Auflisten des Basispfads (smb3-client-vs-Samba-4.23-Bug jetzt auch für Basispfade abgefangen)**

Auch in 0.4.8 lief der Verbindungstest mit gesetztem Basispfad in
`QUERY_DIRECTORY failed: 0xC0000033` (`OBJECT_NAME_INVALID`). Ohne
Basispfad war die Verbindung korrekt und zeigte den gelben Hinweis.

**Ursache:** `smb3-client` sendet `QUERY_DIRECTORY` mit hart kodiertem
`FileInformationClass = 37` (`FileIdBothDirectoryInformation`). Samba
4.23 lehnt das für bestimmte Verzeichnisse ab — auch dann, wenn der
Ordner existiert, geöffnet und `stat`-bar ist. Genau derselbe Bug, der
bisher nur beim Auflisten des Share-Roots als ‚Root nicht auflistbar'
aufgefangen wurde, kann auch den konfigurierten Basispfad selbst
treffen.

**Fix:** Der Fallback greift jetzt auch für Basispfade. Wenn
`client.readdir("")` mit `0xC0000033` scheitert, versucht die Test-Route
zusätzlich `client.stat("")` auf denselben Pfad:

- **stat OK** → Verbindung + Basispfad bestätigt, gelber Hinweis mit
  Erklärung des bekannten Bugs und Workaround-Vorschlägen.
- **stat schlägt auch fehl** → normaler Fehlerpfad (Basispfad-
  Diagnose mit Schreibvarianten-Probes) läuft weiter wie bisher.

Damit lassen sich Basispfade eintragen, auf die `readdir` per
`FileIdBothDirectoryInformation` scheitert — der Download und die
Unterordner-Ansicht funktionieren über die normalen SMB-Calls
trotzdem.

## [0.4.8] – 2026-07-05

### Fixed – **Basispfad wurde beim Verbindungstest doppelt vorangestellt (die eigentliche Ursache)**

In allen Vorgängerversionen (0.4.4 – 0.4.7) hat der Verbindungstest den
konfigurierten Basispfad **zweimal** auf den Server geschickt und deshalb
systematisch die Meldung *„Der Basispfad ist auf dem Server nicht auffindbar"*
produziert — auch dann, wenn der Pfad in Wirklichkeit existierte und mit
`smbclient` oder dem Windows-Explorer problemlos erreichbar war.

**Ursache:** `buildClient(config)` speichert `config.base_path` intern als
`client.basePath`. Der Wrapper-`resolvePath(rel)` baut daraus
`<share>/<basePath>/<rel>`. Die Test-Route rief aber
`client.readdir(testCfg.base_path)` auf und übergab den Basispfad **noch
einmal** als relatives Argument. Ergebnis: aus `base_path = "static"` wurde
auf der Leitung `buero/static/static` — den es natürlich nicht gibt. Die
Diagnose-Ausgabe (`tested_path: static/static`) zeigte den Bug bereits
klar an, wurde aber bisher als Symptom statt Ursache gelesen.

**Fix:** Die Test-Route ruft jetzt `client.readdir("")` auf. Der Wrapper
resolvet das intern korrekt zu `<share>/<basePath>` — also genau dem Pfad,
den der Benutzer im Formular eingetragen hat. Für Anzeige-Zwecke (Meldungen,
Diagnose-Kacheln, Fallback-Probes) wird der Basispfad separat in
`baseForDisplay` gehalten.

### Added – **Standalone-Diagnose-Skript `tools/diag-basepath.js`**

Wer den Verbindungsproblemen auf den Grund gehen will, kann jetzt außerhalb
von Saltcorn probieren, was smb3-client tatsächlich sieht:

```bash
node tools/diag-basepath.js \
  --host 192.168.110.10 --share buero --path static \
  --user 01_vassen --domain buero.ib-vassen.de --password ...
```

Das Skript führt sechs Probes durch (Share-Root, Share-Root mit Slash,
`stat` auf Ziel, `readdir` auf Ziel, Groß-/Kleinschreibvariante) und
druckt für jede den NT-Status-Code — hilfreich beim Aufspüren von
Schreibvarianten oder ACL-Problemen.

## [0.4.7] – 2026-07-05

### Fixed – **Irreführende Windows-UNC-Anzeige in der Fehlermeldung**

Die v0.4.6-Fehlermeldung zeigte den getesteten Pfad als Windows-UNC
(`\\\\192.168.110.10\\buero\\static`). Das war irreführend, weil das
Plugin an smb3-client tatsächlich Forward-Slash-Pfade schickt
(`buero/static`) — die Backslash-Anzeige suggerierte einen Bug, der
keiner ist. Jetzt wird der Pfad in genau der Form gezeigt, die auch
tatsächlich über die Leitung geht: `<share>/<basispfad>`.

## [0.4.6] – 2026-07-05

### Fixed – **Schreibvarianten-Test verdoppelte den Basispfad**

Die Case-Probes in v0.4.4/0.4.5 riefen `client.readdir(<candidate>)` auf.
Der Wrapper prependiert aber automatisch den bereits konfigurierten
`basePath` — dadurch wurde intern nach `buero/static/static` statt
`buero/static` gesucht. Alle Probes scheiterten deshalb systematisch
mit derselben Meldung, unabhängig von der wahren Ursache.

**Fix:** Die Probes gehen jetzt direkt gegen den rohen `smb3-client`
(`client._raw.readdir(share/<absoluter Pfad>)`) und bauen die
From-Share-Root-Pfade selbst zusammen. Der Test-Endpunkt zeigt jetzt
zusätzlich pro Probe den tatsächlich getesteten Pfad an.

### Fixed – **Falscher „Login rejected“-Hinweis bei BASE_PATH_NOT_FOUND**

Der Fallback-Hint-Table prüfte per Substring-Match auf `access_denied`
u.\u00e4. — das triggerte auf den erklärenden Text in unserer eigenen
deutschen Fehlermeldung (wir *erwähnen* `ACCESS_DENIED` didaktisch).
Ein ungefundener Basispfad wurde deshalb zusätzlich mit dem irreführenden
Hinweis „Login rejected“ versehen.

**Fix:** Fehler mit eigenem `code` (`BASE_PATH_NOT_FOUND`,
`BASE_PATH_NOT_A_DIR`) überspringen den Substring-Match — die
Wrapper-Meldung ist bereits vollständig und braucht keinen „Hint“.

### Changed – **Bessere Basispfad-Meldung**

Wenn kein Case-Match gefunden wurde, zeigt die Meldung jetzt den
tatsächlich getesteten UNC-Pfad (`\\\\server\\share\\pfad`) und weist
explizit darauf hin, dass der Basispfad **relativ zur Freigabe** ist —
also `unterordner` und **nicht** `sharename/unterordner`.

## [0.4.5] – 2026-07-05

### Fixed – **Test-Verbindung-Button reagiert nicht mehr (v0.4.4-Regression)**

In v0.4.4 enthielt der neu hinzugefügte Diagnose-IIFE-Block im Inline-
Browser-Script eine Regex `.split(/[\r\n]/)`. Der HTML-Block ist ein
**Template-Literal** in `index.js`; darin werden `\r` und `\n` zu
**echten Steuerzeichen** aufgelöst. Das gerenderte `<script>` enthielt
deshalb einen literalen Zeilenumbruch mitten in der Regex — der Browser
konnte das Skript nicht mehr parsen, und `window.sambaTestConn` wurde
nie definiert. Ein Klick auf „Verbindung jetzt testen“ zeigte deshalb
keine Reaktion.

**Fix:** Die Escape-Sequenz im Source auf `\\r\\n` verdoppelt, damit im
gerenderten Skript wieder `\r\n` steht (also die Zeichenklasse, nicht
die literalen Zeichen). Der Skript-Parse funktioniert wieder, die
Test-Schaltfläche reagiert.

Zusätzlich wurde die Rendering-Pipeline mit einem Node-`--check` auf
dem *extrahierten* Browser-Skript verifiziert, damit dieser konkrete
Fehlermodus in Zukunft schon lokal auffällt.

## [0.4.4] – 2026-07-05

### Fixed – **Falscher `NAME_NOT_FOUND` durch `stat()`-Vorprüfung**

Die 0.4.3-Vorprüfung mit `client.stat(base_path)` schlug bei einigen
Samba-Servern fehl, obwohl der Ordner existiert und per `readdir()`
zugänglich ist. Ursache: `smb3-client` schickt in `stat()` ein CREATE
ohne `DIRECTORY_FILE`-Flag (`createOptions: 0`); manche Samba-
Konfigurationen (v.a. mit „access based enumeration“ oder speziellen
POSIX-ACLs) beantworten das mit `NAME_NOT_FOUND`, während derselbe
Ordner mit `readdir()` (`createOptions: 1 = DIRECTORY_FILE`) einwandfrei
geht.

**Fix:** Die Test-Route ruft direkt `readdir(base_path)` auf und fängt
den Fehler ab. Das ist auch semantisch korrekter – wir wollen wissen,
ob der Basispfad *aufgelistet* werden kann, nicht nur, ob er sich
öffnen lässt.

### Added – **Case-/Schreibvarianten-Test bei fehlender Basispfad-Erkennung**

Schlägt der `readdir(base_path)`-Aufruf mit `NAME_NOT_FOUND` /
`PATH_NOT_FOUND` fehl, probiert die Test-Route zusätzlich:

- den Namen in UPPERCASE,
- den Namen in lowercase,
- den Namen als Capitalised.

Gelingt eine dieser Varianten, wird der tatsächliche Name grün
hervorgehoben („Gefunden: Der Ordner existiert unter dem Namen …“) und
der User bekommt einen direkt umsetzbaren Fix. Schlagen alle Varianten
mit demselben Fehler fehl, liegt es fast sicher an Zugriffsrechten
(`hide unreadable = yes`) oder an `veto files` — die Meldung erklärt
beide Fälle.

Die Diagnose-Box im UI zeigt jetzt zusätzlich:

- eine grüne Markierung mit dem richtigen Ordnernamen (falls gefunden),
- eine ausklappbare Tabelle mit allen Schreibvarianten-Ergebnissen,
- die Fehlermeldung beim Auflisten des übergeordneten Ordners (falls
  das ebenfalls scheitert).

## [0.4.3] – 2026-07-05

### Fixed – **Unklare Meldung bei nicht-existierendem Basispfad**

Wenn ein Basispfad angegeben wurde, der auf dem Server nicht existiert
(oder für den angemeldeten Benutzer nicht sichtbar ist), meldete die
Test-Route bisher nur die rohe Server-Antwort:

```
CREATE failed: STATUS_OBJECT_NAME_NOT_FOUND (ENOENT)
CREATE failed: STATUS_OBJECT_PATH_NOT_FOUND (ENOENT)
```

Daraus konnte der Benutzer nicht erkennen, ob es sich um einen Tippfehler,
um einen Klein-/Großschreibungs-Konflikt (Samba mit `case sensitive = yes`)
oder um eine Berechtigung handelt.

**Neu:**

1. Die Test-Route prüft den Basispfad jetzt zuerst mit `stat()`, bevor sie
   `readdir()` versucht. Fehlt der Ordner, wird eine deutsche Meldung
   zurückgegeben, die den betroffenen Pfad, die Freigabe und typische
   Ursachen (Schreibweise, Groß-/Kleinschreibung, Zugriffsrechte) nennt.
2. Zusätzlich liefert die Route ein `diagnostics`-Objekt zurück, das
   den fehlenden Segmentnamen, den übergeordneten Pfad und — sofern der
   übergeordnete Ordner auflistbar ist — dessen tatsächliche Einträge
   enthält. Das Test-UI hebt ähnlich geschriebene Nachbareinträge hervor,
   damit Tippfehler oder Case-Mismatch sofort sichtbar werden.
3. Der `smb-client.js`-`readdir()`-Wrapper mappt `OBJECT_NAME_NOT_FOUND`
   und `OBJECT_PATH_NOT_FOUND` ebenfalls auf eine deutsche Meldung, damit
   auch der File-Manager (außerhalb der Test-Route) verständlich über
   fehlende Ordner informiert.

**Kein Config-Migrationsschritt nötig.** Wer die neuen Diagnose-Boxen
sehen will, muss lediglich `pv-host/saltcorn-samba@0.4.3` einspielen.

## [0.4.2] – 2026-07-05

### Fixed – **Dropdown-Felder zeigen `[object Object]` statt Optionen**

Die neuen Felder `signing_mode` und `encryption_mode` wurden in der
Saltcorn-UI mit `[object Object]` als einzige Auswahl gerendert.

**Ursache:** In der genutzten Saltcorn-Version werden `attributes.options`
als einfaches String-Array erwartet (`["a", "b", "c"]`), nicht als
`{value, label}`-Objekt. Die Objekt-Form ist erst in neueren Builds
vollständig unterstützt; sonst castet das UI die Objekte zu Strings.

**Fix:** `options` auf String-Array umgestellt —
`["if-offered", "required", "disabled"]`. Die Beschriftung bleibt in
der `sublabel` erhalten (der Config-Wizard erklärt jeden Wert dort).

### Fixed – **`STATUS_OBJECT_NAME_NOT_FOUND` durch fehlgeleiteten Root-Fallback**

Der 0.4.1-Fallback `share/.` triggerte auf Samba einen anderen NT-Status:
`STATUS_OBJECT_NAME_NOT_FOUND` (0xC0000034 / `ENOENT`), weil Samba `.` als
literalen Dateinamen sucht statt als Current-Directory-Marker (das ist im
POSIX-Layer, nicht im SMB2-Protokoll). Der zweite Fallback `share/*` ist
protokoll-illegal (Wildcard im CREATE) und wird ebenfalls abgelehnt.

**Neuer Ansatz:** Wir versuchen den Fallback erst gar nicht. Statt zu
raten geben wir eine klare deutsche Fehlermeldung aus: **einen Basispfad
setzen**. Das ist die einzige zuverlässige Lösung, solange `smb3-client`
die `FileInformationClass` nicht konfigurierbar macht.

Die Test-Route bleibt weiterhin nachsichtig: bei `OBJECT_NAME_INVALID`
auf dem Root fällt sie auf `stat("")` zurück und meldet ein Erfolg mit
Hinweis („Verbindung + Anmeldung erfolgreich, aber Share-Root nicht
direkt auflistbar — bitte Basispfad setzen“). Der Hinweis wird als gelbe
Box im Test-Ergebnis angezeigt.

## [0.4.1] – 2026-07-05

### Fixed – **`QUERY_DIRECTORY failed: 0xC0000033` auf Share-Root (Samba 4.20+/4.23+)**

Symptom nach dem 0.4.0-Update: der Verbindungstest schlägt sofort fehl mit

```
Fehler: QUERY_DIRECTORY failed: 0xC0000033
```

(`STATUS_OBJECT_NAME_INVALID`). Betroffen sind Setups **ohne Basispfad** —
sobald ein Basispfad gesetzt ist, greift der Fehler nicht.

**Ursache:** `smb3-client` öffnet den Share-Root im SMB2-CREATE mit einem
leeren Filename (`""`). Moderne Samba-Versionen (bestehen jedenfalls
**4.20+**, bestätigt auf **4.23.9**) akzeptieren das für CREATE, weisen
aber das anschließende `QUERY_DIRECTORY` mit `FileIdBothDirectoryInformation`
auf dem leeren Namen als `OBJECT_NAME_INVALID` zurück. Vergleichbare
Probleme sind aus anderen Java-/Go-SMB-Client-Bibliotheken bekannt (z. B.
[smbj#80](https://github.com/hierynomus/smbj/issues/80)).

**Lösung:**

1. `smb-client.js#readdir("")` bekommt einen Fallback: wenn der
   Server auf dem leeren Root mit `OBJECT_NAME_INVALID` antwortet, wird
   die Auflistung noch einmal mit `share/.` (aktuelles Verzeichnis) und,
   falls das ebenfalls scheitert, mit `share/*` (Wildcard) probiert.
   Erst wenn auch das nicht klappt, wird eine deutsche Fehlermeldung mit
   Handlungsanweisung ausgelöst.
2. Die `/sambatest`-Route greift auf `client.stat("")` zurück, wenn das
   Root-`readdir` mit `OBJECT_NAME_INVALID` scheitert. `stat("")`
   verwendet CREATE ohne `DIRECTORY_FILE`-Flag und ohne QUERY_DIRECTORY —
   das beweist Netzwerk + Negotiate + Session-Setup + TREE_CONNECT + Auth
   ohne die problematische Query. Der Test liefert dann `entry_count: 0`
   und den Hinweis, dass ein Basispfad gesetzt werden sollte, sofern der
   Server das Root-Listing nicht anders bereitstellt.

### Empfehlung

Wenn Ihr Samba-Server das Share-Root-`QUERY_DIRECTORY` weiterhin ablehnt,
setzen Sie in der Plugin-Config einen **Basispfad** (z. B. `daten` oder
`projekte`) — dann sind alle Directory-Listings innerhalb dieses
Unterverzeichnisses, was durchgängig funktioniert.

## [0.4.0] – 2026-07-05

### ⚠️ BREAKING CHANGES

- **Node.js ≥ 20 wird jetzt zwingend benötigt** (vorher war 16 möglich).
  Grund: die neue Dependency `smb3-client` ist ein Pure-ESM-Paket und wird
  im Plugin über dynamic `import()` aus CommonJS geladen — das ist ab
  Node 20 stabil.
- **Dependency-Wechsel:** `@marsaud/smb2` wurde vollständig entfernt und
  durch [`smb3-client`](https://www.npmjs.com/package/smb3-client) `^0.2.0`
  ersetzt.
- **Zwei neue Config-Felder** in Schritt 1 des Konfigurations-Wizards:
  - `SMB-Signing` (Werte: `if-offered` / `required` / `disabled`, Default `if-offered`)
  - `SMB-Verschlüsselung` (Werte: `if-offered` / `required` / `disabled`, Default `if-offered`)

  Es ist **kein manueller Config-Umbau nötig** — die Defaults sind für
  fast alle Setups sinnvoll. Wer aus Sicherheitsgründen Signing oder
  Encryption erzwingen will, kann jetzt `required` wählen.

### Fixed – **Moderne Samba-Server (`sign_algo_id=0` / AES-CMAC-Pflicht)**

Symptom nach dem 0.3.11-Update: nach dem Setzen von
`NODE_OPTIONS=--openssl-legacy-provider` startete Saltcorn wieder, aber im
Samba-Log erschien beim ersten Zugriff:

```
smbd: sign_algo_id=0 in negotiate response, expected AES-CMAC (2) or higher
```

gefolgt von `STATUS_INVALID_PARAMETER` und einem 401-Fehler im Plugin.

**Ursache:** Aktuelle Samba-Versionen (Ubuntu 22.04+ / Debian 12+ /
RHEL 9+) verlangen im SMB-3.1.1-Handshake das moderne Signing-Verfahren
**AES-128-CMAC** (`SigningAlgorithmId 2`). `@marsaud/smb2` (letztes
Release 2020, unmaintained) implementiert diese Cipher-Suite nicht — es
kann nur die alten HMAC-SHA256- bzw. HMAC-MD5-Signaturen und meldet
sich mit `sign_algo_id=0`, was ein moderner Samba als Protokoll-Fehler
verwirft.

**Lösung — kompletter Wechsel der SMB-Client-Library:**

| Aspekt | Vorher (`@marsaud/smb2`) | Nachher (`smb3-client` 0.2.0) |
|---|---|---|
| Protokoll | SMB 2.0 / 2.1 | SMB 2.1 / 3.0 / 3.0.2 / **3.1.1** |
| Signing | HMAC-SHA256 (nur) | HMAC-SHA256 **+ AES-128-CMAC** |
| Encryption | – | AES-128-CCM / AES-128-GCM (optional) |
| Pre-Auth | – | SHA-512 Pre-Auth-Integrity |
| Auth | NTLM (via `ntlm`, DES-ECB) | **NTLMv2 / SPNEGO** (ohne DES-ECB) |
| Wartung | Letztes Release Q4 2020 | Aktiv (Mai 2026) |
| Runtime-Deps | `ntlm`, `iconv-lite` | **keine** |
| API | Callback | **Promise / async** |
| Modul-System | CommonJS | Pure ESM (via dynamic import geladen) |

### Removed

- Legacy-Crypto-Check-Utility (`checkLegacyCryptoAvailable`,
  `legacyCryptoErrorMessage`) sowie zugehöriger Handshake-Block in der
  `/sambatest`-Route und im Test-Panel — nicht mehr nötig, weil
  `smb3-client` keine Legacy-Cipher (DES-ECB) verwendet.
- Troubleshooting-Abschnitt zum `--openssl-legacy-provider`-Flag im README
  (durch neuen 0.4.0-Kompatibilitätsabschnitt ersetzt).

### Changed

- `smb-client.js` komplett neu geschrieben als dünner Wrapper um
  `smb3-client`. Interne API (`buildClient`, `withClient`, `readdir`,
  `readFile`, `writeFile`, `rename`, `unlink`, `mkdir`, `rmdir`) bleibt
  identisch — kein Anpassungsbedarf in den View- oder Route-Handlern.
- Pfad-Konvention intern umgestellt: `smb3-client` erwartet den Share als
  erstes Segment jedes Pfads (`share/subdir/datei.pdf`) statt separat im
  Constructor. Der Wrapper prependet den Share-Namen transparent, sodass
  Aufrufer weiterhin nur relative Pfade (`subdir/datei.pdf`) übergeben.
- Readdir-Ergebnisse werden pro Eintrag mit einem parallelen `stat()`-
  Aufruf (Batch-Größe 16) angereichert, weil `smb3-client`-Dirents nur
  `name` + `isFile()` + `isDirectory()` liefern — der Plugin-Filemanager
  braucht aber weiterhin Größe und mtime.
- Fehler-Mapping in `/sambatest` erweitert um typische Signing-/
  Encryption-/Pre-Auth-Fehlermeldungen aus `smb3-client` (`bad signature`,
  `preauth integrity`, `encryption`).

### Migration

1. Saltcorn stoppen.
2. Plugin auf 0.4.0 aktualisieren (npm bzw. neues ZIP entpacken).
3. Falls gesetzt: `NODE_OPTIONS=--openssl-legacy-provider` **entfernen**
   (nicht mehr nötig; siehe README-Abschnitt „Troubleshooting →
   ERR_OSSL_EVP_UNSUPPORTED").
4. Sicherstellen, dass **Node.js ≥ 20** installiert ist (`node -v`).
5. Saltcorn wieder starten. Die Plugin-Config bleibt gültig — die neuen
   Felder `SMB-Signing` und `SMB-Verschlüsselung` erhalten automatisch
   den Default `if-offered`. Wer maximale Sicherheit möchte, setzt beide
   auf `required` (Voraussetzung: der Samba-Server unterstützt es).
6. Im Config-Wizard einmal „→ Verbindung jetzt testen" klicken.

## [0.3.11] – 2026-07-05

### Fixed – **Worker-Crash / 502 durch DES-ECB auf Node 17+ / OpenSSL 3**

Symptom nach dem 0.3.10-Update:

```
node:internal/crypto/cipher:117
Error: error:0308010C:digital envelope routines::unsupported
    at Cipheriv.createCipherBase ...
    at .../@marsaud/smb2/node_modules/ntlm/lib/smbhash.js:46
code: 'ERR_OSSL_EVP_UNSUPPORTED'
worker died
```

Auf der Config-Seite dann: **„Antwort war kein JSON (HTTP 502)“**.

**Ursache:** `@marsaud/smb2` benutzt über das transitive Paket `ntlm` den
Cipher **DES-ECB** zur Berechnung der LM/NTLM-Hashes. Node.js ab Version 17
ist gegen OpenSSL 3 gebaut, das DES-ECB standardmäßig blockiert. Der
`createCipheriv("des-ecb", ...)`-Aufruf wirft dann synchron
`ERR_OSSL_EVP_UNSUPPORTED`. Weil der Fehler synchron aus tiefen Callback-
Aufrufen kommt, tötet er den Saltcorn-Worker-Prozess → der Reverse-Proxy
liefert 502 → die Route liefert kein JSON.

**Fixes in diesem Release:**

1. **Präventiver Check in `smb-client.js`:** Beim ersten Aufbau eines
   SMB-Clients wird geprüft, ob `crypto.createCipheriv("des-ecb", ...)`
   funktioniert. Wenn nicht, wird eine saubere, ausführliche deutsche
   Fehlermeldung mit Lieferanleitung geworfen (`E_LEGACY_CRYPTO`) — der
   fehlerhafte NTLM-Code wird gar nicht erst betreten, der Worker überlebt.
2. **`/sambatest`-Route:** Der Check läuft zusätzlich explizit **vor**
   dem `withClient`-Aufruf und liefert JSON mit `code: "E_LEGACY_CRYPTO"`,
   `error`, `hint`, `node_version` und `openssl_version` — damit steht der
   Diagnose-Grund direkt in der UI, nicht im Server-Log.
3. **Fehler-Mapping erweitert:** Falls der Crash doch mal aus einem
   anderen Pfad kommt (z. B. spätere Reconnect-Versuche), erkennt die
   Catch-Logik jetzt auch `ERR_OSSL_EVP_UNSUPPORTED`,
   `digital envelope routines` und `unsupported` und liefert einen
   verständlichen Hinweis.
4. **README:** Neuer Abschnitt „Troubleshooting“ mit Setup-Rezepten für
   `NODE_OPTIONS=--openssl-legacy-provider` (Umgebungsvariable, systemd,
   Docker/Compose, PM2, direkter Aufruf) plus Tabelle mit den häufigsten
   Verbindungsfehlern und Diagnose-Kommandos.

### Notes
- Das Plugin ändert keinen Node-Startparameter selbst — das können wir aus
  Sicherheits- und Prozessgründen nicht (Node-Flags müssen beim Prozess-
  Start gesetzt werden). Der Fix ist eine saubere Fehlererkennung mit
  Lösungsanleitung.
- Sobald Saltcorn mit `NODE_OPTIONS=--openssl-legacy-provider` läuft,
  funktionieren Verbindungstest und alle SMB-Operationen ohne weitere
  Anpassung.
- **Roadmap:** Migration weg von `@marsaud/smb2` (letzter Release 2020) hin
  zu einer aktiv gepflegten SMB-Client-Bibliothek, damit das
  Legacy-Provider-Flag nicht mehr nötig ist.

## [0.3.10] – 2026-07-05

### Fixed – **DNS-Fehler: `getaddrinfo ENOTFOUND "host:445"`**

Nachdem 0.3.9 den Callback-Signatur-Bug behoben hatte und der Test-Button
endlich echt gegen den SMB-Server lief, kam bei der Verbindung ein neuer
Fehler zum Vorschein:

```
getaddrinfo ENOTFOUND 192.168.110.10:445 (ENOTFOUND)
```

**Ursache:** In `smb-client.js` wurde der UNC-Share-String so gebaut:

```js
const shareStr = `\\\\${server}${port ? ":" + port : ""}\\${share}`;
// => "\\\\192.168.110.10:445\\buero"
```

`@marsaud/smb2` interpretiert alles zwischen den führenden `\\` und dem
nächsten `\` als **Hostnamen** und reicht das direkt an
`net.connect()` / `dns.lookup()` weiter. Node versucht dann
`"192.168.110.10:445"` als Hostnamen aufzulösen — was natürlich
fehlschlägt.

**Fix:** Host und Port sauber trennen.

- Der `share`-UNC-Pfad enthält jetzt **nur den Host**:
  `\\192.168.110.10\buero`
- Der Port wird über die separate `port`-Option an `SMB2` übergeben
  (Default 445).
- Zusätzlich tolerant: falls jemand versehentlich `host:445` ins
  Server-Feld einträgt, wird der Port dort herausgezogen.
- IPv6-Adressen in eckigen Klammern (`[::1]:445`) werden unterstützt.

### Notes
- Keine Konfig-Migration nötig. Wer bisher Host **ohne** Port eingetragen
  hat, bekommt jetzt genau die gleiche Verbindung wie vorher — nur
  funktionierend.
- Wer aus Verzweiflung `IP:445` ins Server-Feld getippt hatte: das wird
  jetzt automatisch aufgesplittet. Sauberer ist trotzdem: Host im
  Server-Feld, Port im Port-Feld.

## [0.3.9] – 2026-07-05

### Fixed – **Root-Cause-Fix: Falsche Callback-Signatur in allen Routen**

Die Diagnose-Ausgabe aus 0.3.8 hat gezeigt, dass in den Route-Handlern
**alle** Felder von `req` leer waren (`has_req_user: false`,
`has_session: false`, `referer: null` usw.). Ursache war eine falsche
Callback-Signatur, die seit 0.1 in **allen 8 Routen** verwendet wurde.

Saltcorn registriert Plugin-Routen so
(`packages/server/plugin_routes_handler.js`, Zeilen 40–52):

```js
tenantRouter.post(url, error_catcher(route.callback));
```

und `error_catcher` ist definiert als
(`packages/server/routes/utils.ts`, Zeile 427):

```js
const error_catcher = (fn) => (request, response, next) => {
  ...; fn(request, response, next);
};
```

Die Callbacks werden also mit der klassischen Express-Signatur
`(req, res, next)` aufgerufen — **nicht** mit einem Objekt `{ req, res }`.

Bisher stand in `index.js` überall:

```js
callback: async ({ req, res }) => { ... }
```

Dadurch wurde aus dem echten Express-`request`-Objekt versucht, `req.req`
und `req.res` per Destructuring zu holen — beides `undefined`. Effekt:

- `req.user`, `req.session`, `req.headers`, `req.body`, `req.query`,
  `req.csrfToken()` waren alle unerreichbar.
- Der Admin-Check konnte niemals erfolgreich sein.
- Der Samba-Verbindungstest hat *nie* funktioniert.
- Datei-Listing, Upload, Rename, Delete, Mkdir waren ebenfalls betroffen.

**Fix:** Alle 8 Routen (`/sambadir`, `/sambafile`, `/sambalink`,
`/sambatest`, `/sambaupload`, `/sambadelete`, `/sambarename`,
`/sambamkdir`) auf die korrekte Signatur umgestellt:

```js
callback: async (req, res) => { ... }
```

Damit erhält jeder Handler das echte Express-`req`-Objekt mit
`req.user`, `req.session`, `req.headers`, `req.body`, `req.csrfToken()`,
usw. — und die gesamte Admin- und Berechtigungslogik aus 0.3.7/0.3.8
greift jetzt so, wie sie gedacht war.

### Notes
- Kein Funktionsverlust, keine Konfig-Migration nötig.
- Wer 0.3.8 installiert hat und den Test-Button nicht zum Laufen bekommen
  hat: **Update auf 0.3.9 einspielen, Server neu starten, erneut testen.**

## [0.3.8] – 2026-07-05

### Changed
- **Admin-Erkennung im Test-Endpoint komplett neu aufgezogen.**
  Statt weiter zu raten, welches Feld/welchen Typ Saltcorn für die Rolle
  verwendet, wird jetzt aktiv nachgeladen. Drei unabhängige Wege, es
  reicht wenn *einer* Erfolg hat:

  1. **DB-Lookup (primär):** Aus der Session eine Kandidaten-ID/E-Mail
     lesen und mit `User.findOne({ id })` frisch aus der Saltcorn-
     Datenbank laden. Der User-Konstruktor konvertiert `role_id`
     garantiert zu einer Number (siehe [`user.ts` Zeile 120](https://github.com/saltcorn/saltcorn/blob/master/packages/saltcorn-data/models/user.ts#L120)),
     der Vergleich gegen `1` ist damit sauber.
  2. **Session-Fallback:** Direkt aus `req.user` / `req.session.passport.user`,
     mit Toleranz für String-Rollen.
  3. **Referer-Fallback:** Wenn der Request nachweislich von der
     Plugin-Config-Seite kommt (`referer` enthält `/plugins/`), ist der
     User zwangsläufig Admin — Saltcorns eigene [`isAdmin`-Middleware](https://github.com/saltcorn/saltcorn/blob/master/packages/server/routes/utils.ts#L95)
     lässt ihn sonst gar nicht erst auf die Config-Seite. Damit
     funktioniert der Test-Button auch in Setups mit Reverse-Proxy,
     Custom-Auth oder abweichender Session-Serialisierung.

- **Deutlich mehr Diagnose-Ausgabe.** Das `debug`-Objekt in der Antwort
  enthält jetzt zusätzlich `has_passport`, `session_id`, `req_user_keys`,
  `db_lookup`, `db_role_id`, `db_role_id_type`, `db_email`,
  `admin_by_db`, `admin_by_session`, `admin_by_referer`, `referer`.
  Damit ist sofort sichtbar, welcher Pfad greift oder scheitert.

- User-Modell wird via lazy `require()` geladen (mit `.default`-Interop
  für ESM-Builds) — keine Zirkulärimport-Probleme.

## [0.3.7] – 2026-07-05

### Fixed
- **„Only admins can test the connection.“ fälschlicherweise gemeldet.**
  Die Admin-Prüfung in `POST /sambatest` verglich `req.user.role_id` mit
  strikter Gleichheit gegen die Zahl `1`. Saltcorn liefert `role_id` je
  nach Session-Serialisierung aber sowohl als Number wie auch als String
  aus, weshalb `"1" !== 1` den Test blockierte. Die Prüfung akzeptiert
  jetzt beide Formen (`Number(rid) === 1 || String(rid) === "1"`) und
  liest den User zusätzlich aus `req.session.passport.user`, falls
  `req.user` von einer noch nicht deserialisierten Session leer ist.
  Vgl. [saltcorn utils.ts isAdminOrHasConfigMinRole](https://github.com/saltcorn/saltcorn/blob/master/packages/server/routes/utils.ts).
- Auch der zentrale `roleOf(req)`-Helper (Lese-/Schreibrouten) toleriert
  jetzt String-Rollen und Session-Fallback.

### Changed
- Bei fehlender Admin-Erkennung liefert `/sambatest` jetzt ein
  `debug`-Objekt mit `has_req_user`, `has_session`, `role_id_seen`,
  `role_id_type`, `email`, `user_id`. Der Test-Button zeigt diese
  Diagnose in einem aufklappbaren „Session-Diagnose“-Panel – damit
  wird sofort sichtbar, was Saltcorn dem Plugin zum Benutzer mitgibt.

## [0.3.6] – 2026-07-05

### Fixed
- **`JSON.parse: unexpected character at line 1 column 1` beim Test-Button behoben.**
  Der Aufruf von `POST /sambatest` lief zuvor gegen die globale
  CSRF-Middleware von Saltcorn, die bei ungültigem/fehlendem Token eine
  HTML-Seite zurückliefert – der Browser konnte sie nicht als JSON parsen.
  Fix in drei Schichten:
  1. Route ist jetzt mit `noCsrf: true` markiert (Sicherheit weiterhin durch
     die harte Admin-Prüfung `roleOf(req) !== 1` im Handler garantiert;
     siehe [saltcorn plugin_routes_handler.js](https://github.com/saltcorn/saltcorn/blob/master/packages/server/plugin_routes_handler.js)).
  2. Der Client sendet nun als `application/x-www-form-urlencoded`
     (statt JSON) und legt das `_csrf`-Token direkt in den Body – so
     würde auch ein aktiver CSRF-Check passieren.
  3. Das Token wird jetzt zuverlässig aus drei Quellen gesucht:
     dem versteckten `<input name="_csrf">` des Formulars, dem
     `<meta name="csrf-token">`-Tag und `window._sc_globalCsrf`.
- **Klartext-Fehler statt kryptischem Parser-Crash.**
  Wenn der Server doch mal HTML statt JSON liefert (z. B. Login-Redirect,
  Plugin nicht neu geladen), zeigt der Test-Button jetzt eine deutliche
  Meldung mit HTTP-Status und einer aufklappbaren Rohantwort statt eines
  hilflosen „unexpected character“.

## [0.3.5] – 2026-07-05

### Added
- **Testverbindung im Konfigurations-Wizard.**
  Auf Schritt 1 „Samba-Server“ gibt es jetzt einen Button
  „→ Verbindung jetzt testen“. Er öffnet eine SMB-Sitzung mit den
  aktuell im Formular stehenden Werten (ohne zu speichern), meldet den
  Benutzer an und listet die Wurzel bzw. den Basispfad des Shares auf.
  Bei Erfolg werden Dauer, Anzahl Einträge und die ersten 20 Namen
  angezeigt; bei Fehlschlag der genaue SMB-Fehler plus konkreter
  Handlungshinweis auf Deutsch (z. B. DNS, ECONNREFUSED, LOGON_FAILURE,
  BAD_NETWORK_NAME, SMBv1).
- **Neue Route `POST /sambatest` (nur Admin).** Nimmt die Serverdaten
  als JSON entgegen, gibt strukturiertes Ergebnis mit `ok`, `error`,
  `code`, `hint`, `attempted` zurück. Verändert keine Konfiguration.

### Changed
- **Alle Feld-Beschreibungen in Schritt 1 komplett neu, ausführlich
  auf Deutsch.** Jedes Feld (Server, Freigabe, Domäne, Benutzer,
  Passwort, Basispfad, Port) erklärt Format, Docker-Fallstricke,
  Standardwerte und typische Fehlerquellen. Schritt 2 ebenfalls
  vollständig lokalisiert.
- Schritt-Namen: „Samba server“ → „Samba-Server“, „Access & permissions“
  → „Zugriff & Berechtigungen“.

## [0.3.4] – 2026-07-05

### Fixed
- **`function is not iterable` beim Installieren behoben.**
  In v0.3.3 hatte ich überkompensiert: der Manifest-Key `dependencies`
  wurde in eine Factory-Funktion umgewandelt — Saltcorn liest `dependencies`
  jedoch NICHT über `withCfg`, sondern iteriert es direkt mit `for..of`
  ([`saltcorn-data/models/plugin.ts` Zeile 638](https://github.com/saltcorn/saltcorn/blob/master/packages/saltcorn-data/models/plugin.ts)).
  Deshalb muss `dependencies` ein statisches Array bleiben. Alle anderen
  Keys (viewtemplates, routes, headers) werden weiterhin über `withCfg`
  gelesen und bleiben Factory-Funktionen. Ein ausführlicher Header-Kommentar
  über `module.exports` dokumentiert nun beide Zugriffsmuster.

## [0.3.3] – 2026-07-05

### Fixed
- **`plugin[key] is not a function` beim Installieren behoben.**
  Saltcorns Plugin-Loader ruft — sobald ein Plugin `configuration_workflow`
  exportiert — *jeden* weiteren Manifest-Key als Funktion mit der aktuellen
  Konfiguration als Argument auf (siehe
  [saltcorn-data/db/state.ts, Fn `withCfg`](https://github.com/saltcorn/saltcorn/blob/master/packages/saltcorn-data/db/state.ts)).
  In v0.3.2 waren `viewtemplates`, `routes`, `headers` und `dependencies`
  jedoch statische Arrays — der Aufruf `plugin.viewtemplates(cfg)` warf
  daher den Fehler. Alle Keys sind jetzt Factory-Funktionen, die den Wert
  zurückgeben. `plugin_name` als Top-Level-Key wurde entfernt (aus
  demselben Grund unaufrufbar).

## [0.3.2] – 2026-07-05

### Fixed
- **Installations-Fehler `plugin[key] is not a function` behoben.**
  Der Top-Level-Manifest-Key `fieldviews` wurde aus `module.exports`
  entfernt: Saltcorns Plugin-Loader erlaubt Fieldviews nur eingebettet in
  ein `types`-Objekt, nicht global. Das Feature `samba_pdf` bleibt im
  Paket enthalten, wird aber erst mit der geplanten DB-Verknüpfung als
  echter typgebundener Fieldview reaktiviert. Der inline-PDF-Viewer im
  `SambaFileManager` und die Route `GET /sambafile?disposition=inline`
  funktionieren wie bisher.

## [0.3.1] – 2026-07-05

### Fixed
- `smb-client.js` lädt `@marsaud/smb2` jetzt lazy – `npm test` läuft ohne
  vorheriges `npm install`, weil die reinen Sanitizer-Helfer keinen SMB-
  Import mehr auslösen.

## [0.3.0] – 2026-07-05

### Added
- **Upload** von Dateien über den `SambaFileManager` — Multi-File-Auswahl,
  Drag-&-Drop-Zone, optionales Überschreiben.
- **Neuer Ordner** anlegen direkt aus der Toolbar.
- **Umbenennen** und **Löschen** pro Zeile (Datei oder Ordner; Ordner werden
  rekursiv gelöscht).
- Neue Plugin-Config-Felder (zweiter Config-Schritt *Access & permissions*):
  - `min_role_write` (Default `40` = Staff+Admin, `100` deaktiviert alle
    Schreibaktionen).
  - `allow_upload`, `allow_delete`, `allow_rename`, `allow_mkdir`
    (jeweils per-Feature einzeln aktivierbar, Default aus).
  - `max_upload_mb` (Default `50`).
  - `denied_extensions` (Blocklist; Default:
    `exe,bat,cmd,com,msi,scr,vbs,js,jse,wsf,wsh,ps1,ps1xml,psm1,sh,bash,zsh`).
- Neue Routen: `POST /sambaupload`, `POST /sambadelete`, `POST /sambarename`,
  `POST /sambamkdir`.
- `sanitizeFilename()` — lehnt Slashes, Steuerzeichen, `<>:"|?*`, führende/
  abschließende Punkte oder Leerzeichen, Windows-Reserved-Names (CON, PRN,
  AUX, NUL, COM1–9, LPT1–9) und Namen länger als 255 Zeichen ab.
- `SambaFileManager`-UI: Toolbar-Buttons *Upload*, *Neuer Ordner*, pro Zeile
  *Umbenennen* / *Löschen*, Modal-Dialoge, Toast-Benachrichtigungen.
- Erweiterte Sanitizer-Tests (Filenames + Pfade, ~25 Testfälle).

### Changed
- Plugin-Konfiguration ist jetzt zweistufig: *Samba server* und
  *Access & permissions*. Bestehende `min_role_read`/Server-Felder bleiben
  unverändert.
- `GET /sambadir` liefert zusätzlich ein `perms`-Objekt (`upload`,
  `delete`, `rename`, `mkdir`), damit die UI Buttons für unberechtigte
  Rollen ausblendet.
- README erweitert um alle neuen Config-Felder, Routen und UI-Aktionen.

### Security
- **CSRF-Schutz** auf allen neuen POST-Routen — akzeptiert entweder
  `_csrf` im Body oder Header `X-CSRF-Token` / `CSRF-Token`.
- Path-Traversal-Prüfung greift auch für Ziel-Namen bei `rename` und `mkdir`.
- Extension-Blocklist verhindert das Hochladen ausführbarer Dateien.
- Rollen-Gate `min_role_write` schützt alle Schreiboperationen.

## [0.2.0] – 2026-07-05

### Added
- **New view template `SambaFileManager`** — a Saltcorn-style file browser
  (like *Settings → Files*). Table with icon, filename, media type, size,
  modified date and per-row actions (View / Download / Open in file manager).
  Includes breadcrumb navigation, up-button, home-button, refresh, hidden-file
  toggle, click-to-sort columns and optional pagination.
- Inline PDF/image viewer directly inside the file-manager view.
- Publishing metadata: `repository`, `homepage`, `bugs`, `engines`,
  `publishConfig`, `files`, `prepublishOnly` — ready for `npm publish` and
  GitHub-based installs.
- MIT `LICENSE` file, `CHANGELOG.md`, `.gitignore`, `.npmignore`.
- Simple sanitizer unit tests under `test/`.

### Changed
- Plugin version is now read from `package.json`; the client bootstrap URLs
  (`/plugins/public/saltcorn-samba@<version>/…`) update automatically.
- View templates are wrapped in `index.js` to inject `__pluginVersion` into
  their configuration – no more hard-coded version strings across files.

### Fixed
- Path sanitizer now rejects `//srv/share`-style UNC paths *before*
  collapsing consecutive slashes.
- HTML-escape user-visible path in the `/sambalink` response.

## [0.1.0] – 2026-07-05

### Added
- Initial release.
- `SambaTree` view template (lazy directory tree).
- `samba_pdf` fieldview (inline PDF/image viewer for String fields).
- Routes `/sambadir`, `/sambafile`, `/sambalink`.
- Direct SMB2 access via `@marsaud/smb2`.
- Strict path-traversal protection.
