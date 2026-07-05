# Changelog

All notable changes to `saltcorn-samba` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

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
