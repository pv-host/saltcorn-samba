# Changelog

All notable changes to `saltcorn-samba` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

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
