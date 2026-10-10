# Konzept: Zugriff an die View binden (View-Bindung)

Stand: v0.6.0 (2026-10-10) · Autor: Peter Vassen

## Ausgangslage und Bedrohung

Bis v0.5.0 bestimmte der Browser bei jedem Request selbst, **welche
Verbindung** (`conn`) und **welcher Pfad** (`path`) gelesen oder verändert
wird. Der Server prüfte nur die Rolle. Beispiel:

> Eine Show-View *Kunde* bettet einen `SambaFileManager` auf
> `kunden/<kundennummer>` ein. Ein Mitarbeiter mit Rolle *Staff* sieht nur
> Kunde 42 – kann aber mit `GET /sambadir?path=kunden/43` oder
> `?conn=personal` jeden anderen Ordner und jede andere Verbindung lesen,
> mit Schreibrolle auch löschen.

Weitere Befunde der Prüfung:

| Befund | Auswirkung | Behebung |
|---|---|---|
| `/sambatest` akzeptierte einen gefälschten `Referer` als Admin-Nachweis | ohne Login: Verbindungen zu beliebigen Hosts (Port-Scan/SSRF), Auflisten der gespeicherten Freigabe | Fallback entfernt, CSRF aktiv |
| HTML/SVG vom Share inline als `text/html` ausgeliefert | gespeichertes XSS auf der Saltcorn-Domain | CSP-Sandbox, `text/plain`, `nosniff` |
| `table.getRow(state)` ohne Zeilenrechte; State ohne passende Spalte → erste Zeile | Ordner fremder Datensätze sichtbar | `loadRowForView()` mit `forUser` |
| *Pfad aus Feld* ohne Datensatz → Rückfall auf `view_base_path` | Ordner aller Datensätze sichtbar | `assertRowPath()` (fail closed) |

## Betrachtete Varianten

| Variante | Vorteile | Nachteile | Entscheidung |
|---|---|---|---|
| **A: Signiertes Token (HMAC), zustandslos** | funktioniert über alle Worker/Knoten ohne gemeinsamen Speicher; keine Session-Schreibzugriffe; unit-testbar | einzelnes Token nicht vorzeitig widerrufbar; Token in Link-URLs | **gewählt** |
| B: Erlaubte Views in der Session speichern | kein Token in URLs, sofort widerrufbar | jede Seitenansicht schreibt die Session (Saltcorn: PostgreSQL), wächst bei vielen Views, Race Conditions bei parallelen Tabs | verworfen |
| C: Route lädt die View-Konfiguration selbst (`?view=Name&id=…`) | keine Kryptografie | Route müsste Saltcorns komplette View-/Zeilenlogik nachbauen (eingebettete Views, runMany, State) – fehleranfällig | verworfen |
| D: Nur Rollen pro Verbindung (Stand 0.5.0) | einfach | bindet keine Ordner, nur Verbindungen | nicht ausreichend |

## Umsetzung

**Token** = `base64url(JSON)` + `.` + `base64url(HMAC-SHA256)`:

```
{ v:1, c:"default", r:"kunden/42", w:true, h:true, l:true, u:"7", vn:"Kunde", e:1791234567 }
```

- **Schlüssel:** `HMAC(session_secret, "saltcorn-samba/view-token/v1|<Tenant-Schema>")`.
  Saltcorns `session_secret` signiert ohnehin die Session-Cookies und ist auf
  allen Workern gleich. Pro Mandant abgeleitet → keine Wiederverwendung über
  Mandanten. Optional eigenes Geheimnis (Plugin-Konfiguration).
- **Prüfung** (`connectionForRequest`): Signatur (timing-sicher), Version,
  Ablauf, User-ID; danach Verbindung aus dem Token (nicht aus `conn`), Rechte
  = Verbindung UND View; `inScope()` für jeden Pfad (Segmentgrenzen).
- **Ausstellen** (`viewTokenFor` in `view-common.js`) erst NACH dem Laden
  des Datensatzes mit Saltcorns Zeilenrechten – das Token enthält nur, was
  der Nutzer in dieser View tatsächlich sehen darf.
- **Laufzeit** 12 h (1–168 h einstellbar), gleitende Verlängerung bei
  Nutzung über den Antwort-Header `X-Samba-View-Token`.
- **Übergang:** Modus `optional` lässt Requests ohne Token wie bisher zu.

## Restrisiken

- Ein Token ist bis zum Ablauf gültig. Rollenänderungen wirken trotzdem
  sofort (Rolle wird bei jedem Request geprüft); notfalls alle Tokens durch
  Ändern des *Geheimnisses für View-Tokens* ungültig machen.
- Das Token steht in Link-URLs (Browser-Verlauf, Proxy-Logs). Es nützt nur
  dem Benutzer, für den es ausgestellt wurde, und nur für den Ordner der View.
  `Referrer-Policy: no-referrer` verhindert das Weitergeben an Dritte.
- Wer direkten SMB-Zugriff hat, ist von der Bindung nicht betroffen –
  Service-Accounts pro Verbindung bleiben die wichtigste Maßnahme.

## Ausblick

- Kurzlebige, einmalige Download-Tokens für Links (statt des View-Tokens).
- Audit-Log schreibender Aktionen (Benutzer, View, Pfad) in eine
  Saltcorn-Tabelle.
- Connection-Pool pro Verbindung.
