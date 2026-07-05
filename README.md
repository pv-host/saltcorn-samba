# saltcorn-samba

Ein Saltcorn-Plugin für den Zugriff auf einen **Samba-/CIFS-Server (SMB2/3)**
direkt aus dem Browser — ohne Mount, ohne `smbclient` im Container.

Features:

- 📂 **`SambaFileManager`-View** — Datei-Manager wie *Einstellungen → Dateien* in Saltcorn: Tabelle mit Symbol, Name, MIME-Typ, Größe, Änderungsdatum und Aktionen. Breadcrumb-Navigation, Up-/Home-/Refresh-Button, Sortierung per Spaltenklick, Pagination, Anzeige versteckter Dateien optional.
- 🌳 **`SambaTree`-View** — Lazy-loading Verzeichnisbaum, ideal zum Einbetten in Show-Views.
- 📄 **`samba_pdf`-Fieldview** — String-Feld mit Datei-Pfad → PDF/Bild inline im Browser, plus Download- und externe-App-Buttons.
- 🚀 **`smb://`-Links** — Öffnet Dateien und Ordner direkt in Nemo, Nautilus, Dolphin (Linux) oder Explorer (Windows).
- 🔒 **Sicherheit** — Base-Path als „Chroot", strenge Path-Traversal-Prüfung (`..`, absolute Pfade, UNC, Drive-Letters, NUL-Bytes), rollenbasierter Zugriff.
- 🐳 **Docker-freundlich** — direkt per SMB2-Protokoll, keine System-Binaries nötig.

---

## Screenshots

Der `SambaFileManager` ist optisch am eingebauten Saltcorn-File-Browser
orientiert: dieselben Spalten (Filename, Media type, Size, Modified) und
Aktionsknöpfe.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Samba files                                    3 folders · 12 files │
├─────────────────────────────────────────────────────────────────────┤
│ ⬆ Up  🏠  ↻   / kunden / akte-42          ☐ Show hidden             │
├─────────────────────────────────────────────────────────────────────┤
│    Filename ▲     Media type       Size    Modified    Actions      │
│ 📁 vertraege      folder                   2026-06-01  [Open]       │
│ 📁 rechnungen     folder                   2026-06-15  [Open]       │
│ 📄 anschreiben.pdf application/pdf 84 KiB  2026-06-20  [View] [DL] ↗│
│ 🖼️ logo.png      image/png        12 KiB  2026-05-11  [View] [DL] ↗│
└─────────────────────────────────────────────────────────────────────┘
```

---

## Installation

### 1. Über die Saltcorn-Plugin-Verwaltung (empfohlen)

Sobald das Plugin auf npm veröffentlicht ist:

1. Einstellungen → Plugins → „…" → *Add another plugin*
2. Name: `saltcorn-samba`
3. Source: **npm**
4. Location: `saltcorn-samba`
5. Version leer lassen (aktuellste) oder z. B. `0.2.0`

### 2. Direkt aus GitHub

1. Einstellungen → Plugins → „…" → *Add another plugin*
2. Name: `saltcorn-samba`
3. Source: **github**
4. Location: `pv-host/saltcorn-samba`

### 3. Lokale Installation (Entwicklung)

```bash
git clone https://github.com/pv-host/saltcorn-samba.git
cd saltcorn-samba
npm install
saltcorn install-plugin -d "$PWD"
```

Alternativ manuell via UI: Source = `local`, Location = absoluter Pfad.

### 4. Docker

Plugin-Ordner als Volume in den Container einbinden:

```yaml
services:
  saltcorn:
    image: saltcorn/saltcorn:latest
    volumes:
      - ./plugins/saltcorn-samba:/opt/plugins/saltcorn-samba
    # Der SMB-Port des Samba-Servers muss aus dem Container erreichbar sein.
```

Anschließend in Saltcorn als *local* Plugin mit
`Location = /opt/plugins/saltcorn-samba` registrieren.

Verbindung testen:

```bash
docker exec -it <saltcorn-container> \
  node -e "require('net').createConnection(445,'IP-DES-SAMBA').on('connect',()=>{console.log('ok');process.exit()}).on('error',e=>{console.error(e.message);process.exit(1)})"
```

---

## Konfiguration

Nach der Installation unter *Einstellungen → Plugins → saltcorn-samba →
Configure* ausfüllen:

| Feld | Beispiel | Beschreibung |
|---|---|---|
| Server | `192.168.1.10` | Hostname oder IP des Samba-Servers |
| Share name | `documents` | Name des Shares (ohne Slashes) |
| Domain / Workgroup | `WORKGROUP` | optional |
| Username | `saltcorn-reader` | SMB-Benutzer |
| Password | *(secret)* | wird im Saltcorn-Konfigstore gespeichert |
| Base path | `projects` | *optional* — beschränkt jeden Zugriff auf dieses Unterverzeichnis |
| Port | `445` | Standard-SMB2-Port |
| Minimum role to read files | `80` | 1=Admin, 40=Staff, 80=User, 100=public |
| SMB host visible to clients | `fileserver.lan` | *optional* — Host, der in `smb://`-Links auftaucht (nützlich in Docker) |

**Empfehlung:** legen Sie auf dem Samba-Server einen read-only Nutzer an,
der ausschließlich auf die relevanten Freigaben Zugriff hat. Zusätzlich mit
*Base path* den Bereich absichern.

---

## Verwendung

### View: `SambaFileManager`

Menu → Views → *Create view* → Template `SambaFileManager`.

Optionen:

| Option | Zweck |
|---|---|
| **Root directory mode** | `static` = immer Base-Path aus Plugin-Config, `from_field` = Sub-Pfad kommt aus einem DB-Feld der aktuellen Zeile |
| **Row field with sub-path** | Feld der Tabelle mit dem relativen Ordnernamen (bei `from_field`) |
| **Extra sub-path** | statischer Suffix (z. B. `invoices`) |
| **Show hidden files** | `.dotfiles` einblenden |
| **Allow navigating up** | Up-Button aktivieren (nur bis zum Root, kein Ausbruch) |
| **Open PDFs / images inline** | Klick öffnet die Datei im integrierten Viewer |
| **Show "Open in file manager" button** | `smb://`-Link pro Zeile |
| **Page size** | Einträge pro Seite (0 = alle) |
| **Panel title** | Text im Karten-Header |

Beispiel-Datenmodell für kunden-spezifische Ordner:

```
Tabelle:  kunden
Felder:   name (String), akte_dir (String, z. B. "kunde_42/2026")
```

Dann eine Show-View von `kunden` bauen und die `SambaFileManager`-View mit
Mode = `from_field`, Row field = `akte_dir` einbetten.

### View: `SambaTree`

Kompaktere Alternative – lazy-loading Baum, ideal in einer Sidebar oder
neben Formularen. Gleiche Path-Modi wie beim File-Manager.

### Fieldview `samba_pdf`

Für ein String-Feld mit Datei-Pfad (relativ zum Base-Path). In der View-
Konfiguration `Field view = samba_pdf` wählen. Rendert PDFs im `<iframe>`,
Bilder als `<img>`, alles andere als Download-Buttons.

### smb://-Links

Jeder Datei-/Ordner-Eintrag hat einen ↗-Button. Klick öffnet die Route
`/sambalink`, die eine kleine HTML-Zwischenseite mit `smb://`-Anker rendert.

- Linux: GNOME/Cinnamon/KDE → Nautilus / Nemo / Dolphin
- Windows: Explorer
- macOS: Finder

*Hinweis:* Chromium blockiert direkte `smb://`-Redirects, deshalb die
Zwischenseite mit sichtbarem Klick-Link.

---

## Routen (öffentliche HTTP-API des Plugins)

| Methode + URL | Parameter | Zweck |
|---|---|---|
| `GET /sambadir`  | `path`, `show_hidden` | JSON-Verzeichnisliste |
| `GET /sambafile` | `path`, `disposition=inline\|attachment` | Datei-Stream |
| `GET /sambalink` | `path` | HTML-Seite mit `smb://`-Anker |

Alle Routen prüfen die Rolle des angemeldeten Nutzers gegen
`min_role_read` aus der Plugin-Konfiguration und validieren jeden Pfad
gegen Path-Traversal.

---

## Sicherheit

- **Base-Path als Chroot** — sanitizer verhindert das Verlassen.
- **Path-Prüfung** — `..`, absolute Pfade (`/foo`), UNC (`//srv/share`,
  `\\srv\share`), Drive-Letters (`C:`, `d:\`), NUL-Bytes werden abgelehnt.
- **Read-only SMB-Nutzer** empfohlen.
- **Rollen-Gate** — `min_role_read` per Konfiguration.
- **Kein öffentliches Caching** — Files werden mit `Cache-Control: no-store`
  ausgeliefert.
- **HTML-Escape** in allen serverseitig gerenderten Antworten.

Unit-Tests zum Sanitizer laufen in CI (`npm test`).

---

## Entwicklung

```bash
npm install
npm run lint    # Syntax-Check aller JS-Dateien
npm test        # Sanitizer-Tests
```

Lokale Saltcorn-Instanz mit Live-Reload:

```bash
saltcorn install-plugin -d "$PWD"
SALTCORN_NWORKERS=1 saltcorn serve --dev
```

Anschließend Änderungen an `index.js`/`filemanager-view.js`/etc. → Server
lädt neu.

### Als npm-Paket veröffentlichen

```bash
# In package.json: version bumpen, CHANGELOG ergänzen
npm login
npm run lint && npm test       # läuft auch als prepublishOnly
npm publish                    # --access public wird durch publishConfig gesetzt
git tag v0.2.0 && git push --tags
```

### Als GitHub-Plugin nutzbar machen

Nach `git push` auf `main`/`master` können Saltcorn-Nutzer das Plugin ohne
npm direkt installieren:

```
Source:   github
Location: pv-host/saltcorn-samba
```

Saltcorn führt `npm install` im Plugin-Ordner automatisch aus.

### Ins Saltcorn-Store-Verzeichnis eintragen

1. Auf https://store.saltcorn.com/ einloggen (Admin-Rolle nötig)
2. „Add extension" → Name `saltcorn-samba`, Source `npm`, Location `saltcorn-samba`
3. Beschreibung + Kategorie eintragen

Ab dann taucht das Plugin im Plugins-Store jeder Saltcorn-Instanz auf.

---

## Bekannte Grenzen

- **Read-only** — kein Upload / Löschen / Umbenennen (kommt in v0.3).
- Dateien werden komplett gepuffert (`readFile`). Für >100 MB besser
  einen CIFS-Mount + Saltcorn-`File`-Typ nutzen.
- **Nur SMB2/3** — SMBv1 wird nicht unterstützt.
- **Ein SMB-User** entscheidet über Sichtbarkeit — für rollen­spezifische
  Sichtbarkeit auf Share-Ebene arbeiten oder mehrere Plugin-Instanzen
  verwenden.

---

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md).

---

## Lizenz

MIT © 2026 Peter Vassen
