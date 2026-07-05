# saltcorn-samba

Ein Saltcorn-Plugin für den Zugriff auf einen **Samba-/CIFS-Server (SMB2/3)**
direkt aus dem Browser — ohne Mount, ohne `smbclient` im Container.

Features:

- 📂 **`SambaFileManager`-View** — Datei-Manager wie *Einstellungen → Dateien* in Saltcorn: Tabelle mit Symbol, Name, MIME-Typ, Größe, Änderungsdatum und Aktionen. Breadcrumb-Navigation, Up-/Home-/Refresh-Button, Sortierung per Spaltenklick, Pagination, Anzeige versteckter Dateien optional.
- ⬆️ **Upload / Neuer Ordner / Umbenennen / Löschen** — optional aktivierbar,
  Multi-File-Upload mit Drag-&-Drop, Toast-Feedback, Rollen-Gate.
- 🌳 **`SambaTree`-View** — Lazy-loading Verzeichnisbaum, ideal zum Einbetten in Show-Views.
- 📄 **Inline-PDF-/Bild-Anzeige** direkt im `SambaFileManager` (Klick auf eine Datei), plus Download- und externe-App-Buttons.
- 🚀 **`smb://`-Links** — Öffnet Dateien und Ordner direkt in Nemo, Nautilus, Dolphin (Linux) oder Explorer (Windows).
- 🔒 **Sicherheit** — Base-Path als „Chroot", strenge Path-Traversal-Prüfung (`..`, absolute Pfade, UNC, Drive-Letters, NUL-Bytes), CSRF-Schutz auf Schreib-Routen, Filename-Sanitizer, Extension-Blocklist, rollenbasierter Zugriff (getrennte Lese-/Schreib-Rollen).
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
5. Version leer lassen (aktuellste) oder z. B. `0.3.0`

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
Configure* ausfüllen. Die Konfiguration ist zweistufig:

### Schritt 1 — *Samba-Server*

| Feld | Beispiel | Beschreibung |
|---|---|---|
| **Server** | `192.168.1.20`, `nas01`, `fileserver.local` | Hostname oder IP des Samba-Servers, **ohne** `smb://`-Präfix und **ohne** Backslashes. Muss aus Sicht des Saltcorn-Prozesses auflösbar sein. **In Docker:** nicht `localhost` verwenden – stattdessen LAN-IP des Hosts oder Container ins passende Netzwerk hängen. |
| **Freigabe / Share-Name** | `daten`, `public`, `projekte` | Name der SMB-Freigabe **ohne** Slashes. Auf dem Server als `[NAME]`-Abschnitt in `smb.conf` bzw. unter Windows als Freigabename sichtbar. Nicht die Ordner-Bezeichnung. |
| **Domäne / Arbeitsgruppe** | `WORKGROUP`, `CONTOSO` | Meist `WORKGROUP` (Standard). Für Active Directory: NetBIOS-Name der Domäne, nicht der FQDN. |
| **Benutzername** | `saltcorn` | Samba-/AD-Benutzer, **nicht** im Format `DOMAIN\user` (Domäne gehört in das eigene Feld). Leer lassen für anonymen Zugriff (nur bei `guest ok = yes`). |
| **Passwort** | *(secret)* | Samba nutzt ein eigenes Passwort (`smbpasswd`), nicht zwingend das Linux-Login. Moderne Server lehnen leere Passwörter ab. |
| **Basispfad** | `projekte/2026` | Optional. Relativ, mit Slashes, **ohne** führenden `/`. Beschränkt jeden Zugriff auf dieses Unterverzeichnis der Freigabe. `..` und absolute Pfade werden abgelehnt. |
| **TCP-Port** | `445` | Standard SMB2/3 über TCP. **SMBv1 (139) wird nicht unterstützt** – auf dem Server `min protocol = SMB2` setzen. |

> **Tipp:** Bevor Sie speichern, klicken Sie auf **„→ Verbindung jetzt
> testen“** – siehe Abschnitt [Verbindung testen](#verbindung-testen).

### Schritt 2 — *Zugriff & Berechtigungen*

| Feld | Default | Beschreibung |
|---|---|---|
| Minimum role to read files | `80` | 1=Admin, 40=Staff, 80=User, 100=public |
| Minimum role to write files | `40` | `100` deaktiviert Schreibaktionen komplett |
| Allow upload | *aus* | schaltet Upload-Button + `POST /sambaupload` frei |
| Allow delete | *aus* | schaltet Löschen frei (`POST /sambadelete`) |
| Allow rename | *aus* | schaltet Umbenennen frei (`POST /sambarename`) |
| Allow mkdir | *aus* | schaltet *Neuer Ordner* frei (`POST /sambamkdir`) |
| Max. Upload-Größe (MB) | `50` | Limit pro Datei |
| Denied file extensions | `exe,bat,cmd,com,msi,scr,vbs,js,jse,wsf,wsh,ps1,ps1xml,psm1,sh,bash,zsh` | kommagetrennte Blocklist |

**Empfehlung:**

- Nur die Features aktivieren, die wirklich gebraucht werden.
- Auf dem Samba-Server einen separaten Nutzer mit passenden Rechten anlegen
  (read-only wenn nur gelesen werden soll).
- Zusätzlich mit *Basispfad* den Zugriff auf ein Unterverzeichnis begrenzen.

### Verbindung testen

Direkt im Konfigurations-Wizard (Schritt 1) gibt es den Button
**„→ Verbindung jetzt testen“**. Er sendet die aktuell im Formular
stehenden Werte an die interne Route `POST /sambatest` (nur für Admins),
baut eine SMB-Verbindung auf und listet den Basispfad bzw. die
Share-Wurzel auf. Es werden dabei **keine** Daten gespeichert oder
geschrieben.

- **Erfolg (grün):** Dauer der Verbindung, Anzahl gefundener Einträge
  und die ersten 20 Namen (Datei/Ordner) werden angezeigt.
- **Fehler (rot):** Der SMB-/Netzwerk-Fehler wird im Klartext gezeigt,
  zusammen mit einem konkreten Handlungshinweis auf Deutsch, z. B.:
  - `ECONNREFUSED` → Samba läuft nicht oder Firewall/Docker blockt 445
  - `ETIMEDOUT` → Host nicht erreichbar (Ping/`nc -vz`)
  - `ENOTFOUND` → DNS-Auflösung fehlgeschlagen (IP verwenden)
  - `LOGON_FAILURE` / `ACCESS_DENIED` → Benutzer, Passwort oder Domäne falsch
  - `BAD_NETWORK_NAME` → Share-Name existiert so nicht auf dem Server
  - `SMB1 / protocol` → Server bietet nur SMBv1 an (nicht unterstützt)

Die Route kann zusätzlich auch von Skripten aufgerufen werden:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  --cookie "$COOKIES" \
  -d '{"server":"192.168.1.20","share":"daten","username":"u","password":"p"}' \
  https://saltcorn.example.com/sambatest
```

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

### Fieldview `samba_pdf` (deaktiviert seit 0.3.2)

> Der eigenständige Fieldview `samba_pdf` ist temporär nicht als
> Fieldview registriert, weil er ohne DB-Verknüpfung an einen konkreten
> Saltcorn-Typ gebunden werden müsste. Er kehrt in einer späteren
> Version zusammen mit der DB-Integration zurück. Bis dahin liefert der
> `SambaFileManager` selbst die Inline-Anzeige.

_Historische Beschreibung:_

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

### Lesen (GET, Rolle ≥ `min_role_read`)

| Methode + URL | Parameter | Zweck |
|---|---|---|
| `GET /sambadir`  | `path`, `show_hidden` | JSON-Verzeichnisliste + `perms` |
| `GET /sambafile` | `path`, `disposition=inline\|attachment` | Datei-Stream |
| `GET /sambalink` | `path` | HTML-Seite mit `smb://`-Anker |

### Schreiben (POST, Rolle ≥ `min_role_write`, CSRF-Token erforderlich)

| Methode + URL | Body / Form | Zweck |
|---|---|---|
| `POST /sambaupload` | `multipart/form-data`: `dir`, `file` (n-fach), `overwrite`, `_csrf` | Dateien hochladen |
| `POST /sambadelete` | JSON: `path`, `_csrf` | Datei/Ordner (rekursiv) löschen |
| `POST /sambarename` | JSON: `path`, `new_name`, `_csrf` | Umbenennen |
| `POST /sambamkdir`  | JSON: `dir`, `name`, `_csrf` | Neuen Ordner anlegen |

Das CSRF-Token wird von Saltcorn per `req.csrfToken()` erzeugt. Der Client
übergibt es entweder als Feld `_csrf` im Body oder als HTTP-Header
`X-CSRF-Token` (bzw. `CSRF-Token`). Wer CSRF für diese Routen abschalten
möchte, kann das in den Saltcorn-*Users & Security*-Einstellungen tun.

Alle Routen prüfen die Rolle, validieren jeden Pfad gegen Path-Traversal
und lehnen Filenames ab, die Slashes, Steuerzeichen, `<>:"|?*`,
führende/abschließende Punkte oder Windows-Reserved-Names enthalten.

---

## Sicherheit

- **Base-Path als Chroot** — sanitizer verhindert das Verlassen.
- **Path-Prüfung** — `..`, absolute Pfade (`/foo`), UNC (`//srv/share`,
  `\\srv\share`), Drive-Letters (`C:`, `d:\`), NUL-Bytes werden abgelehnt.
- **Filename-Sanitizer** für Upload / Rename / Mkdir — lehnt Slashes,
  Steuerzeichen, `<>:"|?*`, führende/abschließende Punkte, Leerzeichen und
  Windows-Reserved-Names (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`)
  ab.
- **CSRF-Schutz** auf allen POST-Routen (Body `_csrf` oder Header
  `X-CSRF-Token`).
- **Extension-Blocklist** für Uploads (Default blockt exe/bat/cmd/vbs/js
  u.ä.), konfigurierbar.
- **Getrennte Rollen-Gates** — `min_role_read` und `min_role_write`, plus
  Feature-Toggles pro Schreib-Aktion.
- **Kein öffentliches Caching** — Files werden mit `Cache-Control: no-store`
  ausgeliefert.
- **HTML-Escape** in allen serverseitig gerenderten Antworten.

Unit-Tests zum Path- und Filename-Sanitizer laufen in CI (`npm test`).

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
git tag v0.3.0 && git push --tags
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

- Dateien werden komplett gepuffert (`readFile` / `writeFile`). Für
  Dateien > 100 MB besser einen CIFS-Mount + Saltcorn-`File`-Typ nutzen.
- **Nur SMB2/3** — SMBv1 wird nicht unterstützt.
- **Ein SMB-User** entscheidet über Sichtbarkeit und Schreibrechte auf
  dem Share — für rollen­spezifische Sichtbarkeit auf Share-Ebene
  arbeiten oder mehrere Plugin-Instanzen verwenden.
- **Keine DB-Verknüpfung** von SMB-Dateien (geplant für spätere Version).

---

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md).

---

## Lizenz

MIT © 2026 Peter Vassen
