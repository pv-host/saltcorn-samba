# saltcorn-samba

Ein Saltcorn-Plugin für den Zugriff auf einen oder **mehrere Samba-/CIFS-Server
(SMB2/3)** direkt aus dem Browser — ohne Mount, ohne `smbclient` im Container.

Features:

- 📂 **`SambaFileManager`-View** — Datei-Manager wie *Einstellungen → Dateien* in Saltcorn: Tabelle mit Symbol, Name, MIME-Typ, Größe, Änderungsdatum und Aktionen. Breadcrumb-Navigation, Up-/Home-/Refresh-Button, Sortierung per Spaltenklick, Pagination, Anzeige versteckter Dateien optional.
- ⬆️ **Upload / Neuer Ordner / Umbenennen / Löschen** — optional aktivierbar,
  Multi-File-Upload mit Drag-&-Drop, Toast-Feedback, Rollen-Gate.
- 🔀 **Mehrere Verbindungen** (ab 0.5.0) — beliebig viele Server/Freigaben pro Saltcorn-Instanz; jede View wählt ihre Verbindung, optional pro Datensatz. Siehe [Mehrere Verbindungen](#mehrere-verbindungen).
- 🌳 **`SambaTree`-View** — Lazy-loading Verzeichnisbaum, ideal zum Einbetten in Show-Views.
- 📄 **Inline-PDF-/Bild-Anzeige** direkt im `SambaFileManager` (Klick auf eine Datei), plus Download- und externe-App-Buttons.
- 🚀 **`smb://`-Links** — Öffnet Dateien und Ordner direkt in Nemo, Nautilus, Dolphin (Linux) oder Explorer (Windows).
- 🔒 **Sicherheit** — Base-Path als „Chroot", strenge Path-Traversal-Prüfung (`..`, absolute Pfade, UNC, Drive-Letters, NUL-Bytes), CSRF-Schutz auf Schreib-Routen, Filename-Sanitizer, Extension-Blocklist, rollenbasierter Zugriff (getrennte Lese-/Schreib-Rollen).
- 🔐 **Moderne SMB-Kryptografie** — SMB 3.1.1 mit **AES-128-CMAC-Signing** (Pflicht auf aktuellen Samba-Servern) und optionaler **AES-CCM/GCM-Verschlüsselung**. Signing- und Encryption-Modus per Config-Dropdown wählbar (`if-offered` / `required` / `disabled`). **Keine Legacy-Cipher** (DES-ECB) mehr nötig — läuft ohne `--openssl-legacy-provider` unter Node 20+.
- 🐳 **Docker-freundlich** — direkt per SMB2/3-Protokoll, keine System-Binaries nötig.

> **Voraussetzungen:** **Node.js ≥ 20** (wegen der ESM-basierten [`smb3-client`](https://www.npmjs.com/package/smb3-client) Library, die intern per dynamic `import()` geladen wird). Saltcorn 0.9+ wird unterstützt.

---

## Was ist neu in 0.7.0 (Konfiguration)

- **Eine Liste für alle Verbindungen:** Die bisher separat konfigurierte
  Standardverbindung ist jetzt ein normaler Eintrag der Verbindungsliste
  (Schritt 1). Der Wizard hat nur noch zwei Schritte.
- **Standardverbindung wählbar** (Schritt 2): Views mit der Auswahl
  `default` nutzen sie; leer = erster Eintrag.
- **Keine Nacharbeit an bestehenden Installationen:** Die alte
  Einzelverbindung wird automatisch als Eintrag `default` übernommen,
  bestehende Views laufen unverändert weiter (Details unter
  [Übernahme aus älteren Versionen](#übernahme-aus-älteren-versionen-bis-06)).

## Was ist neu in 0.6.0 (Sicherheit)

- **View-Bindung:** Jede Samba-View erhält beim Anzeigen ein signiertes
  Token. Verbindung, Startordner, Benutzer und erlaubte Aktionen sind damit
  an genau diese View gebunden. Ein Nutzer kann über manipulierte Requests
  weder eine andere Verbindung noch einen Ordner außerhalb „seiner“ View
  ansprechen. Details: [View-Bindung](#view-bindung).
- **Zeilenrechte:** Im Modus *Pfad aus Feld* lädt die View den Datensatz
  jetzt mit Saltcorns Tabellenrechten (Eigentümer, Leserolle). Fehlt der
  Datensatz oder der Ordnerwert, zeigt die View eine Meldung statt – wie
  bisher – still den übergeordneten Ordner (`view_base_path`) aller
  Datensätze.
- **Sichere Dateiauslieferung:** HTML, SVG und andere aktive Inhalte vom
  Share werden nur noch in einer CSP-Sandbox angezeigt (kein JavaScript auf
  der Saltcorn-Domain), Textdateien immer als `text/plain`, dazu `nosniff`
  und `Referrer-Policy: no-referrer`.
- **Verbindungstest abgesichert:** Die Route `/sambatest` ließ sich bis 0.5.0
  ohne Anmeldung nutzen, wenn ein passender `Referer`-Header mitgeschickt
  wurde (frei fälschbar). Diese Ausnahme und der CSRF-Verzicht sind entfernt.
- Neue View-Option *Nur lesen (diese View)* im File-Manager.

⚠️ **Nach dem Update:** Offene Browser-Tabs mit Samba-Views neu laden.
Eigene Skripte, die `/sambadir`, `/sambafile` … direkt aufrufen, brauchen
ein View-Token – oder vorübergehend den Modus *Zugriff nur über Views* =
`optional` (Schritt 2).

---

## Was ist neu in 0.5.0

- **Bugfix Upload:** Hochgeladene Dateien kamen als **0-Byte-Dateien** auf dem
  Share an, obwohl „OK“ gemeldet wurde (Saltcorn legt Uploads als Temp-Datei
  ab, das Plugin las den leeren Speicherpuffer). Jetzt wird die Temp-Datei
  gelesen, die Größe nach dem Schreiben gegengeprüft und die Temp-Datei
  gelöscht.
- **Bugfix Ordner anlegen / Upload → 403:** Buttons wurden auch angezeigt,
  wenn die Aktion in Schritt 2 nicht aktiviert war; der Server lehnte dann
  ab. Sichtbarkeit und Prüfung nutzen jetzt dieselbe Funktion.
  ⚠️ **Prüfen Sie nach dem Update Schritt 2:** Upload, Löschen, Umbenennen
  und Ordner anlegen müssen dort angehakt sein, sonst erscheinen die Buttons
  nicht mehr.
- **Neu: mehrere Verbindungen** — Konfigurationsschritt 3 *Weitere
  Verbindungen*; Views erhalten die Felder *Samba-Verbindung* und
  *Verbindung aus Feld*. Bestehende Konfigurationen laufen unverändert als
  Verbindung `default` weiter.
- Verständliche deutsche Fehlermeldungen für SMB-Statuscodes
  (z. B. `STATUS_ACCESS_DENIED` → „Zugriff verweigert …“).

Konzept und Begründung: [docs/KONZEPT-mehrere-verbindungen.md](docs/KONZEPT-mehrere-verbindungen.md).

---

## Was ist neu in 0.4.0 (Migration von 0.3.x)

Das Plugin wurde intern von der unmaintained `@marsaud/smb2` auf die moderne
`smb3-client` umgestellt. **Kein Config-Umbau nötig** — die neuen Felder
`SMB-Signing` und `SMB-Verschlüsselung` haben sinnvolle Defaults (`if-offered`).
Dadurch:

- ✅ funktioniert wieder gegen moderne Samba-Server, die `sign_algo_id != 0`
  (AES-CMAC) verlangen,
- ✅ **kein** `--openssl-legacy-provider`-Flag mehr nötig,
- ⚠️ **Breaking:** Node.js ≥ 20 zwingend erforderlich (vorher 16 möglich).

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
Configure* ausfüllen. Die Konfiguration hat zwei Schritte.

### Schritt 1 — *Server-Verbindungen*

Alle Samba-Server bzw. Freigaben stehen gleichberechtigt in **einer
Liste**. Über **„Hinzufügen“** legen Sie beliebig viele Verbindungen an;
jede View wählt eine davon aus. Jeder Eintrag hat diese Felder:

| Feld | Beispiel | Beschreibung |
|---|---|---|
| **Kennung** | `default`, `archiv`, `nas-standort2` | Eindeutiger technischer Name, über den Views die Verbindung auswählen. Erlaubt: Buchstaben, Ziffern, `_ - .`, max. 40 Zeichen. |
| **Anzeigename** | `Zentrale` | Optional; erscheint als Badge im Kopf der View. Leer = Kennung. |
| **Server** | `192.168.1.20`, `nas01`, `fileserver.local` | Hostname oder IP des Samba-Servers, **ohne** `smb://`-Präfix und **ohne** Backslashes. Muss aus Sicht des Saltcorn-Prozesses auflösbar sein. **In Docker:** nicht `localhost` verwenden – stattdessen LAN-IP des Hosts oder Container ins passende Netzwerk hängen. |
| **Freigabe / Share-Name** | `daten`, `public`, `projekte` | Name der SMB-Freigabe **ohne** Slashes. Auf dem Server als `[NAME]`-Abschnitt in `smb.conf` bzw. unter Windows als Freigabename sichtbar. Nicht die Ordner-Bezeichnung. |
| **Domäne / Arbeitsgruppe** | `WORKGROUP`, `CONTOSO` | Meist `WORKGROUP` (Standard). Für Active Directory: NetBIOS-Name der Domäne, nicht der FQDN. |
| **Benutzername** | `saltcorn` | Samba-/AD-Benutzer, **nicht** im Format `DOMAIN\user` (Domäne gehört in das eigene Feld). Leer lassen für anonymen Zugriff (nur bei `guest ok = yes`). |
| **Passwort** | *(secret)* | Samba nutzt ein eigenes Passwort (`smbpasswd`), nicht zwingend das Linux-Login. Moderne Server lehnen leere Passwörter ab. |
| **Basispfad** | `projekte/2026` | Optional. Relativ, mit Slashes, **ohne** führenden `/`. Beschränkt jeden Zugriff auf dieses Unterverzeichnis der Freigabe. `..` und absolute Pfade werden abgelehnt. |
| **TCP-Port** | `445` | Standard SMB2/3 über TCP. **SMBv1 (139) wird nicht unterstützt** – auf dem Server `min protocol = SMB2` setzen. |
| **SMB-Signing** | `if-offered` | `if-offered` (Standard), `required` oder `disabled`. Nutzt HMAC-SHA256 (SMB 2.x) bzw. AES-128-CMAC (SMB 3.x). Moderne Samba-Server verlangen häufig Signing → `required` oder `if-offered`. |
| **SMB-Verschlüsselung** | `if-offered` | `if-offered` (Standard), `required` oder `disabled`. Nutzt AES-128/256-CCM/GCM. Shares mit serverseitigem `SMB2_SHAREFLAG_ENCRYPT_DATA` erzwingen Verschlüsselung ohnehin. |
| **Für Clients sichtbarer SMB-Hostname** | `fileserver.firma.de` | Optional; wird nur in erzeugten `smb://`-Links verwendet (z. B. wenn Saltcorn den Server intern per IP erreicht). |
| **Nur lesen** | *aus* | Sperrt alle Schreibaktionen dieser Verbindung – unabhängig von Rollen. |
| **Mindestrolle Lesen / Schreiben** | *leer* | Optional; leer = globaler Wert aus Schritt 2. |

Hinweise:

- Jede Verbindung hat **eigene Zugangsdaten**; es wird nichts von einer
  anderen Verbindung geerbt.
- Fehlerhafte Einträge (fehlende oder doppelte Kennung, kein Server …)
  werden ignoriert und oben in Schritt 1 aufgelistet; die übrigen
  Verbindungen funktionieren weiter.
- Mit **„Test-Buttons für alle Verbindungen anzeigen“** lässt sich jede
  Verbindung vor dem Speichern prüfen – siehe
  [Verbindung testen](#verbindung-testen).

#### Übernahme aus älteren Versionen (bis 0.6)

Bis 0.6 gab es eine separat konfigurierte Standardverbindung plus
optionale Zusatzverbindungen. **Es ist keine Nacharbeit nötig:**

1. Direkt nach dem Update läuft alles unverändert – das Plugin liest die
   alte Einzelverbindung weiterhin als Verbindung `default`.
2. Beim nächsten Öffnen der Plugin-Konfiguration steht sie bereits als
   erster Listeneintrag `default` in Schritt 1 (Hinweis „Übernommen“),
   gefolgt von den bisherigen Zusatzverbindungen.
3. Einmal speichern: Die Konfiguration wird ins Listenformat überführt,
   die alten Einzelfelder (inkl. Passwort) werden geleert.

Views mit der Auswahl `default` funktionieren in allen Fällen weiter.
Benennen Sie den Eintrag `default` später um (z. B. in `zentrale`),
nutzen solche Views die **Standardverbindung** aus Schritt 2.

### Schritt 2 — *Zugriff & Berechtigungen*

| Feld | Default | Beschreibung |
|---|---|---|
| **Standardverbindung** | *leer* | Verbindung für Views mit der Auswahl `default` (auch alle Views aus älteren Versionen). Leer = erster Eintrag der Liste. |
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

Direkt im Konfigurations-Wizard (Schritt 1) erzeugt
**„Test-Buttons für alle Verbindungen anzeigen“** je Listeneintrag einen
Button **„Verbindung „…“ testen“**. Dieser sendet die aktuell im Formular
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
| **View-Basispfad (relativ zum Plugin-Basispfad)** | Optionaler statischer Präfix nur für diese View. Beispiel: Plugin-Basispfad = `static`, View-Basispfad = `projekte/2026` → View listet `static/projekte/2026`. Zweistufige Konfiguration: einmal serverweit im Plugin, einmal pro View. |
| **Row-Modus** | `static` = nur der View-Basispfad zählt, `from_field` = zusätzlich wird ein DB-Feldwert der aktuellen Zeile angehängt (z. B. in einer Show-View) |
| **Feld mit Unterpfad** | Feld der Tabelle mit dem relativen Ordnernamen (nur bei `from_field`) |
| **Zusätzlicher Suffix (nach dem Feldwert)** | statischer Suffix, z. B. `invoices` (nur bei `from_field`) |
| **Show hidden files** | `.dotfiles` einblenden |
| **Allow navigating up** | Up-Button aktivieren (nur bis zum Root, kein Ausbruch) |
| **Open PDFs / images inline** | Klick öffnet die Datei im integrierten Viewer |
| **Show "Open in file manager" button** | `smb://`-Link pro Zeile |
| **Page size** | Einträge pro Seite (0 = alle) |
| **Panel title** | Text im Karten-Header |

Der effektive Pfad wird zusammengesetzt aus (jeweils falls gesetzt):
`Plugin-Basispfad / View-Basispfad / Feldwert / Zusätzlicher Suffix`.
`..`-Traversal, absolute Pfade und UNC-Präfixe werden abgelehnt.

Beispiel-Datenmodell für kunden-spezifische Ordner:

```
Tabelle:  kunden
Felder:   name (String), akte_dir (String, z. B. "kunde_42/2026")
```

Dann eine Show-View von `kunden` bauen und die `SambaFileManager`-View mit
Row-Modus = `from_field`, Feld = `akte_dir` einbetten.

### Mehrere Verbindungen

Beide Views (`SambaFileManager`, `SambaTree`) haben zwei zusätzliche
Konfigurationsfelder:

- **Samba-Verbindung** – Auswahl aus `default` (= Standardverbindung aus Schritt 2) und den Kennungen aus Schritt 1.
- **Verbindung aus Feld** (optional) – Textfeld der Tabelle, dessen Wert die
  Kennung liefert. Beispiel: Tabelle *Standorte* mit Spalte `fileserver`
  (`hq`, `werk2`, …) – die Show-View eines Standorts zeigt automatisch dessen
  Fileserver. Ist das Feld leer, gilt die statisch gewählte Verbindung.

Die Verbindung wird beim Anzeigen der View serverseitig aufgelöst und im
View-Token festgeschrieben (siehe [View-Bindung](#view-bindung)). Ist die
Kennung unbekannt, zeigt die View „Unbekannte Samba-Verbindung …“.

**Typische Einsätze:** getrennte Server für Mandanten oder Standorte,
Produktiv- und Archiv-NAS, eine schreibgeschützte Verbindung auf dieselbe
Freigabe (Option *Nur lesen*) für Leser-Views.

### View: `SambaTree`

Kompaktere Alternative – lazy-loading Baum, ideal in einer Sidebar oder
neben Formularen. Gleiche Path-Optionen wie beim File-Manager (inkl.
**View-Basispfad**, **Row-Modus**, **Feld**, **Zusätzlicher Suffix**).

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
| `GET /sambadir`  | `path`, `show_hidden`, `conn`, `vt` | JSON-Verzeichnisliste + `perms` |
| `GET /sambafile` | `path`, `disposition=inline\|attachment`, `conn`, `vt` | Datei-Stream |
| `GET /sambalink` | `path`, `conn`, `vt` | HTML-Seite mit `smb://`-Anker |

Das View-Token wird als Header `X-Samba-View-Token` (fetch) oder als
Parameter `vt` (Links) übergeben. Ohne Token → `401 VIEW_TOKEN_MISSING`
(Modus `required`), abgelaufen → `401 VIEW_TOKEN_EXPIRED`, manipuliert →
`401 VIEW_TOKEN_INVALID`, anderer Benutzer → `403 VIEW_TOKEN_USER`, Pfad
außerhalb der View → `403 VIEW_SCOPE`, View nur lesend → `403 VIEW_READ_ONLY`.
Eine verlängerte Fassung des Tokens liefert `/sambadir` im Antwort-Header
`X-Samba-View-Token`.

### Schreiben (POST, Rolle ≥ `min_role_write`, CSRF-Token erforderlich)

| Methode + URL | Body / Form | Zweck |
|---|---|---|
| `POST /sambaupload` | `multipart/form-data`: `conn`, `path`, `file` (n-fach), `overwrite` | Dateien hochladen |
| `POST /sambadelete` | JSON: `conn`, `path`, `isDir` | Datei/Ordner (rekursiv) löschen |
| `POST /sambarename` | JSON: `conn`, `from`, `newName` | Umbenennen |
| `POST /sambamkdir`  | JSON: `conn`, `path`, `name` | Neuen Ordner anlegen |

`conn` ist optional (fehlt er, gilt `default`). Unbekannte Kennung → `404`,
ungültige Kennung → `400`, fehlende Rolle / deaktivierte Aktion /
*Nur lesen* → `403` mit deutscher Klartext-Meldung. Uploads antworten mit
`207`, wenn einzelne Dateien scheitern (Details in `results[]`).

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

- **View-Bindung** (ab 0.6.0) — Zugriff nur über signierte View-Tokens,
  gebunden an Verbindung, Startordner, Benutzer und View-Rechte (siehe
  unten). Zugangsdaten verlassen den Server nie.
- **Zeilenrechte** — Datensätze für *Pfad aus Feld* werden mit Saltcorns
  Tabellenrechten geladen; ohne Datensatz keine Ansicht (fail closed).
- **Sichere Auslieferung** — aktive Inhalte (HTML, SVG, XML …) nur in einer
  CSP-Sandbox, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`,
  RFC-5987-Dateinamen.
- **Pro Verbindung** zusätzlich *Mindestrolle Lesen/Schreiben*, *Nur lesen*
  und – am wichtigsten – ein eigener SMB-Service-Account mit minimalen
  Rechten.
- **Verbindungstest** `/sambatest` nur für Admins, mit CSRF-Schutz.

### View-Bindung

Beim Anzeigen einer `SambaFileManager`- oder `SambaTree`-View stellt der
Server ein Token aus (HMAC-SHA256, siehe `view-token.js`). Es enthält:

| Claim | Bedeutung |
|---|---|
| Verbindung | Kennung, die die View verwendet – `conn` im Request kann sie nicht ändern |
| Startordner | `view_base_path` + Ordner aus dem Datensatz + Unterpfad; alle Pfade müssen darin liegen (Segmentgrenzen: `kunden/42` erlaubt nicht `kunden/420`) |
| Schreiben | File-Manager: ja, außer *Nur lesen (diese View)*; Tree: nie |
| Versteckte Dateien / smb://-Links | gemäß View-Konfiguration |
| Benutzer | Saltcorn-User-ID; ein Token eines anderen Nutzers wird abgelehnt |
| Ablauf | Standard 12 h; bei Nutzung gleitend verlängert |

Zusätzlich gilt: Der Startordner selbst kann nicht gelöscht oder umbenannt
werden, Umbenennen/Verschieben nach außerhalb ist gesperrt, und die
Rollen-/Verbindungsrechte werden weiterhin bei jedem Request geprüft – die
View kann Rechte nur **einschränken**, nie erweitern.

**Schlüssel:** abgeleitet aus Saltcorns `session_secret` (pro Mandant
getrennt). Alternativ ein eigenes *Geheimnis für View-Tokens* in Schritt 2 –
nötig nur bei mehreren Saltcorn-Knoten mit unterschiedlichen Secrets.

**Modus** *Zugriff nur über Views*:

- `required` (Standard) — Requests ohne gültiges Token → `401`.
- `optional` — Übergangsmodus für eigene Skripte: Requests **ohne** Token
  verhalten sich wie in 0.5 (nur Rollenprüfung); Requests **mit** Token
  bleiben gebunden.

Das Token steht in Links (`vt=…`), weil Browser bei `<a>`, `<iframe>` und
`<img>` keine Header senden. Deshalb liefern die Datei-Routen
`Referrer-Policy: no-referrer`; die Gültigkeit ist begrenzt und das Token
nützt nur dem angemeldeten Benutzer, für den es ausgestellt wurde.

Unit-Tests (Sanitizer, Verbindungen, Rechte) laufen in CI (`npm test`).

### Client-/Server-Trennung

Damit klar ist, wo Sicherheit tatsächlich durchgesetzt wird: das Plugin
läuft in zwei streng getrennten Welten.

- **Serverseitig (Node.js im Saltcorn-Prozess):**
  `index.js` (HTTP-Routen), `smb-client.js` (SMB3-Verbindung, Auth, Signing,
  Encryption), `readdir-compat.js` (Verzeichnis-Listing),
  `filemanager-view.js` / `tree-view.js` / `pdf-view.js`
  (configuration_workflow, run, computeStartPath, sanitizeRelativePath),
  `i18n.js` (Übersetzungskatalog) und `tools/diag-*.js` (CLI-Diagnose).
  **SMB-Credentials (User, Domain, Passwort), Plugin-`base_path` und pro-View
  `view_base_path` liegen ausschließlich serverseitig in der Saltcorn-DB.**
  Der Browser sieht davon nichts.

- **Clientseitig (Browser, unter `public/`):**
  `samba-filemanager.js`, `samba-tree.js`, `samba-common.js` (gemeinsame
  Utilities + i18n) und `samba.css`. Reine UI. Alle Zugriffe laufen über
  `fetch()` mit `X-CSRF-Token`-Header.

- **Enforcement-Punkte serverseitig — in jeder Request-Bearbeitung:**
  1. **CSRF** – Saltcorns globale csurf-Middleware. Ohne Token: 403.
  2. **Auth/Rolle** – Saltcorn prüft Login und View/Table-Rechte vor `run(…)`.
     Zusätzlich prüft jede Route `min_role_read` bzw. `min_role_write`.
  3. **Pfad-Sanitizing** – `sanitizeRelativePath` lehnt `..`, absolute Pfade,
     UNC-Präfixe, Laufwerksbuchstaben und NUL-Bytes ab.
  4. **Base-Path-Enforcement** – der effektive Pfad ist immer relativ zum
     serverseitig konfigurierten `base_path`; `view_base_path` stammt aus der
     View-Konfig, nie aus dem Request.
  5. **SMB-Session** läuft mit dem serverseitig konfigurierten SMB-User; der
     Client kann keine anderen Credentials injizieren.

- **Wichtige Hinweise:**
  `view_base_path` ist **keine** Sicherheitsgrenze zwischen Usern – nur
  Bequemlichkeit. Für Mandantentrennung entweder eigene Views pro Mandant
  (mit Rollen-Steuerung), oder mehrere Plugin-Instanzen mit unterschiedlichen
  SMB-Usern. Produktions-Empfehlung: dedizierter SMB-Service-Account mit
  minimalen Rechten; die Fileserver-ACL limitiert dann zusätzlich.

- **Kurzfassung:** JavaScript in `public/` ist reine Kosmetik. Alle
  Zugriffsrechte werden serverseitig durchgesetzt — ein manipulierter Client
  bekommt genau die gleichen 403/400-Antworten wie ein regulärer.

---

## Internationalisierung (i18n)

Ab v0.4.16 sind alle sichtbaren Texte übersetzbar. Ausgeliefert werden **de**
und **en**.

- Kataloge liegen als JSON unter `i18n/<locale>.json`.
- Die eigentliche Lookup- und Placeholder-Interpolation lebt in **einer**
  gemeinsamen Datei `public/samba-i18n-runtime.js` (UMD-Wrapper), die sowohl
  von `i18n.js` (via `require`) als auch vom Browser (via `<script>` →
  `window.SambaI18nRuntime`) geladen wird. So gibt es keine doppelte
  `interpolate/translate`-Implementierung mehr.
- Serverseitige Nutzung: `const { t, tFor } = require("./i18n");`
  → `t("fm.upload.button", { locale: "de" })` bzw.
  `const _t = tFor("de"); _t("fm.upload.button")`.
- Clientseitig: `window.SambaCommon.t("fm.upload.button")`. Der Katalog wird
  von der View-Shell inline in die Seite injiziert (kein Extra-Request).
- Locale-Auflösung: explizit übergebener Wert → `req.getLocale()` →
  `?locale=xx` → `Accept-Language` → Fallback `en`.
- Neue Sprache ergänzen: `i18n/<locale>.json` anlegen, `availableLocales` in
  `i18n.js` erweitern, PR aufmachen. Fehlt ein Key, greift automatisch der
  englische Fallback — nichts bricht.
- Diagnose-Endpoint: `GET /samba-i18n.json?locale=de` liefert den kompletten
  Katalog als JSON (ohne Auth, enthält keine Konfiguration).

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

## Troubleshooting

### `ERR_MODULE_NOT_FOUND` / „Cannot find package 'smb3-client'" / Worker startet nicht

Das Plugin lädt `smb3-client` (ESM) via dynamic `import()` — das npm-Paket
muss also im Plugin-Ordner installiert sein.

```bash
cd /pfad/zu/saltcorn-samba
npm install
saltcorn restart   # oder systemd/docker-Neustart
```

Bei Installation über die Saltcorn-Plugin-UI (Source `npm` oder `github`)
führt Saltcorn `npm install` automatisch aus.

### `STATUS_INVALID_PARAMETER` / „sign_algo_id=0" im Samba-Log

Das war der Fehler in **0.3.x mit `@marsaud/smb2`**: moderne Samba-Server
(Ubuntu 22.04+ / Debian 12+ / RHEL 9+) verlangen **AES-CMAC-Signing**, das
die alte Library nicht konnte. **In 0.4.0 gelöst** — die neue `smb3-client`-
Library implementiert AES-CMAC. Falls die Meldung dennoch auftaucht:

- In der Plugin-Config **SMB-Signing = `required`** setzen (erzwingt
  AES-CMAC schon beim Handshake).
- Auf dem Server sicherstellen, dass `server signing = mandatory` gesetzt
  ist, dann in der Client-Config ebenfalls `required` wählen.

### `ERR_OSSL_EVP_UNSUPPORTED` / `--openssl-legacy-provider`

**Betrifft 0.4.0 nicht mehr.** Die alte Abhängigkeit `@marsaud/smb2` nutzte
intern DES-ECB (aus dem transitiven `ntlm`-Paket), das ab OpenSSL 3
deaktiviert ist. `smb3-client` verwendet ausschließlich moderne Cipher
(HMAC-SHA256, AES-128-CMAC, AES-CCM/GCM, SHA-512-PreAuth-Integrity).
**Das `NODE_OPTIONS=--openssl-legacy-provider`-Flag darf und sollte in
0.4.0 wieder entfernt werden.**

### Signing- und Verschlüsselungs-Modi

Beide Modi haben denselben Wertebereich:

| Wert | Verhalten |
|---|---|
| `if-offered` **(Standard)** | Wird genutzt, wenn der Server es anbietet. Kompatibel mit alten und neuen Servern. |
| `required` | Wird zwingend verlangt. Verbindung schlägt fehl, wenn der Server nicht mitmacht. Empfohlen für Produktionsumgebungen. |
| `disabled` | Wird nicht angefordert. Nur für Legacy-Server oder isolierte LAN-Setups. Nicht mit Servern kombinieren, die Signing/Encryption erzwingen. |

Typische Fehlermeldungen und was zu tun ist:

| Symptom | Wahrscheinliche Ursache | Lösung |
|---|---|---|
| `bad signature` / `SIGNATURE_MISMATCH` | Uhrzeit-Drift zwischen Client und Server, oder falsche Credentials | Zeit synchronisieren (NTP), Passwort prüfen |
| `preauth integrity` | Man-in-the-Middle oder Netzwerkproblem | Netzwerkpfad prüfen (VPN, Proxy) |
| Verbindung schlägt bei `required` fehl | Server bietet Modus nicht an | Server konfigurieren oder Modus auf `if-offered` senken |

### Weitere häufige Fehler

| Symptom | Ursache | Lösung |
|---|---|---|
| `ECONNREFUSED :445` | SMB-Dienst läuft nicht oder Firewall blockt Port 445 | `nc -vz <server> 445` vom Saltcorn-Host testen |
| `ETIMEDOUT` | Kein Netzwerkpfad (VLAN/Docker-Bridge/VPN) | Vom Saltcorn-Container aus `ping` + `nc -vz` prüfen |
| `LOGON_FAILURE` / `STATUS_LOGON_FAILURE` | User/Passwort/Domain falsch | Zugangsdaten prüfen. Moderne Samba-Server erlauben keine leeren Passwörter |
| `BAD_NETWORK_NAME` / `STATUS_BAD_NETWORK_NAME` | Share existiert nicht oder Schreibweise falsch | `smbclient -L //server -U user` zur Kontrolle |
| Nur SMBv1 verfügbar | Server bietet SMB2/3 nicht an | In `smb.conf`: `min protocol = SMB2` |

---

## Bekannte Grenzen

- Dateien werden komplett gepuffert (`readFile` / `writeFile`). Für
  Dateien > 100 MB besser einen CIFS-Mount + Saltcorn-`File`-Typ nutzen.
- **Nur SMB2/3** — SMBv1 wird nicht unterstützt.
- **Ein SMB-User pro Verbindung** entscheidet über Sichtbarkeit und
  Schreibrechte auf dem Share — für rollen­spezifische Sichtbarkeit mehrere
  Verbindungen mit unterschiedlichen Service-Accounts und Mindestrollen
  anlegen.
- Uploads werden über Saltcorns Standard-Upload angenommen; ist in Saltcorn
  **S3-Storage** aktiv, lehnt das Plugin Uploads mit einer Meldung ab.
- **Keine DB-Verknüpfung** von SMB-Dateien (geplant für spätere Version).
- Der (deaktivierte) Fieldview `samba_pdf` stellt kein View-Token aus und
  funktioniert nur im Modus *Zugriff nur über Views* = `optional`.

---

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md).

---

## Lizenz

MIT © 2026 Peter Vassen
