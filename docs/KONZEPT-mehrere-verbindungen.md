# Konzept: Mehrere Samba-Verbindungen pro Saltcorn-Instanz

Stand: v0.5.0 (2026-10-02) · Autor: Peter Vassen

## Ausgangslage

Bis v0.4.16 kannte das Plugin genau **eine** Verbindung (Server + Freigabe +
Zugangsdaten) in der Plugin-Konfiguration. Saltcorn erlaubt kein zweites
Installieren desselben Plugins mit eigener Konfiguration. Anwendungen, die
z. B. pro Standort, Mandant oder Archiv auf unterschiedliche Fileserver
zugreifen, waren damit nicht umsetzbar.

## Anforderungen

1. Beliebig viele Verbindungen, jede mit eigenen Zugangsdaten und Optionen.
2. Bestehende Installationen laufen **ohne Migration** weiter.
3. Jede View wählt ihre Verbindung – statisch oder **pro Datensatz**.
4. Zugangsdaten verlassen nie den Server.
5. Rechte pro Verbindung einschränkbar (Lesen/Schreiben/Nur lesen).
6. Ein fehlerhafter Eintrag darf die übrigen Verbindungen nicht stören.

## Betrachtete Varianten

| Variante | Vorteile | Nachteile | Entscheidung |
|---|---|---|---|
| **A: FieldRepeat in der Plugin-Konfiguration** | Native Saltcorn-UI („Hinzufügen“), Passwörter wie bisher in der Plugin-Config, keine Tabelle nötig, Backup mit der Konfiguration | Änderungen erfordern Admin-Zugang zur Plugin-Konfiguration | **gewählt** |
| B: JSON-Textfeld | Trivial umzusetzen | Fehleranfällig, Passwörter im Klartext-JSON sichtbar, keine Validierung im Formular | verworfen (wird aber als Fallback gelesen) |
| C: Eigene Saltcorn-Tabelle `samba_connections` | Pflege per Saltcorn-Views, Verknüpfung mit anderen Tabellen | Passwörter in einer normalen Tabelle (Rechte, Exporte, API!), Tabelle muss vom Plugin angelegt/migriert werden | verworfen |
| D: Mehrere Plugin-Kopien unter anderen Namen | Kein Code nötig | Doppelte Routen (`/sambadir` …) kollidieren, Updates n-fach | nicht möglich |

## Umsetzung (Variante A)

- (Stand 0.5–0.6) **`default`** = Felder aus Schritt 1, weitere Verbindungen
  im Feld `connections`, Schritt 3 *Weitere Verbindungen*.
- **Ab 0.7.0:** alle Verbindungen gleichberechtigt in `connections`
  (Schritt 1), Standardverbindung wählbar über `default_connection`;
  Altkonfigurationen werden automatisch übernommen (siehe README,
  „Übernahme aus älteren Versionen“).
- **Kennung** `^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$`, eindeutig
  (ohne Groß-/Kleinschreibung), `default` reserviert.
- **Vererbung:** Globale Einstellungen aus Schritt 2 (allow_*, max_upload_mb,
  denied_extensions, min_role_*) gelten für alle. Verbindungsfelder (Server,
  Zugangsdaten, Basispfad …) werden **nicht** vererbt – kein versehentliches
  Weiterreichen des `default`-Passworts an einen anderen Server.
- **Overrides pro Verbindung:** `min_role_read`, `min_role_write` (leer =
  global), `read_only`.
- **Auflösung:** `connections.js` → `buildConnections()` liefert gültige
  Verbindungen + Liste der Probleme; `resolveConnection(cfg, name)` wirft
  mit HTTP-Status 400/404/500.
- **Routen:** jede Route ruft `connectionForRequest()` auf (Kennung aus
  `conn`, Auflösung, Rollen, Aktions-Flag). Dieselbe Funktion
  `permissionsFor()` liefert die Button-Sichtbarkeit → keine Abweichung
  zwischen UI und Server mehr.
- **Views:** Felder *Samba-Verbindung* (Dropdown) und *Verbindung aus Feld*.
  Der Browser erhält nur Kennung und Anzeigename.

## Sicherheitsbetrachtung

Die Kennung ist vom Client wählbar. Ein angemeldeter Nutzer kann daher per
manipuliertem Request jede Verbindung ansprechen, für die seine Rolle
ausreicht – nicht nur die seiner View. Das ist dasselbe Modell wie beim
`path`-Parameter innerhalb einer Freigabe (seit 0.1). Schutzmaßnahmen:

1. *Mindestrolle Lesen/Schreiben* pro Verbindung (z. B. `1` für Admin-Archive).
2. *Nur lesen* pro Verbindung.
3. Eigener SMB-Service-Account pro Verbindung mit minimalen Rechten
   (wirksamste Maßnahme, unabhängig vom Plugin).
4. Basispfad als „Chroot“ pro Verbindung.

## Ausblick

- ~~**Signierte View-Tokens (HMAC)**~~ — **umgesetzt in v0.6.0**, siehe
  [KONZEPT-view-bindung.md](KONZEPT-view-bindung.md).
- **Verbindungen pro Saltcorn-Tenant** (Multi-Tenant-Installationen nutzen
  bereits getrennte Plugin-Konfigurationen).
- **Connection-Pool** pro Verbindung, um bei vielen Requests den
  SMB-Handshake (Negotiate/Session-Setup) zu sparen.
- Admin-Übersicht „Verbindungsstatus“ (Erreichbarkeit aller Verbindungen).
