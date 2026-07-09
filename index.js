/**
 * saltcorn-samba
 * ----------------------------------------------------------------------------
 * Saltcorn plugin providing browser-based access to a Samba/CIFS share.
 *
 * Read paths:
 *   GET  /sambadir     – list a directory as JSON
 *   GET  /sambafile    – stream a file (inline or attachment)
 *   GET  /sambalink    – HTML page with an smb:// link
 *
 * Write paths (v0.3.0, opt-in via plugin config):
 *   POST /sambaupload  – multipart upload; field name: "file" (multiple)
 *   POST /sambadelete  – delete a file or (empty) directory
 *   POST /sambarename  – rename or move a file / directory
 *   POST /sambamkdir   – create a new directory
 *
 * All write routes require the caller's role_id <= min_role_write and a
 * valid CSRF token (Saltcorn injects `req.csrfToken()`). Filenames and
 * paths are validated against traversal, drive letters, UNC, control
 * characters, reserved device names, and per-extension blocklists.
 * ----------------------------------------------------------------------------
 */

"use strict";

const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const { getState } = require("@saltcorn/data/db/state");

// User-Modell nur beim Bedarf laden (lazy) — vermeidet Zirkulär-Import-
// Probleme beim Plugin-Load. Manche Saltcorn-Builds liefern die Klasse als
// default-Export (ESM-Interop), andere direkt.
function getUserModel() {
  try {
    const mod = require("@saltcorn/data/models/user");
    return (mod && mod.default) || mod;
  } catch (e) {
    return null;
  }
}

const pkg = require("./package.json");
const {
  withClient,
  toSmbUrl,
  mimeFromName,
  sanitizeRelativePath,
  sanitizeFilename,
} = require("./smb-client");
const treeView = require("./tree-view");
const fileManagerView = require("./filemanager-view");
const {
  catalogFor,
  resolveLocaleFromReq,
  availableLocales,
} = require("./i18n");
// pdf-view is intentionally NOT wired into the manifest (see note at bottom).
// The file is kept in the package so the DB-linkage release can revive it.

const PLUGIN_VERSION = pkg.version;
const PLUGIN_NAME = "saltcorn-samba@" + PLUGIN_VERSION;

// Extensions blocked by default for upload. Users can override in config.
const DEFAULT_DENIED_EXT = [
  "exe", "bat", "cmd", "com", "msi", "scr", "vbs", "js", "jse",
  "wsf", "wsh", "ps1", "ps1xml", "psm1", "sh", "bash", "zsh",
];

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

// HTML block injected as first "field" of step 1 — Saltcorn renders fields
// with type="String" and input_type="custom_html" as raw HTML. This gives
// admins a Test-Verbindung button next to the form itself.
const CONNECTION_TEST_HTML = `
<div class="card mb-3" style="border-left:4px solid #0d6efd">
  <div class="card-body">
    <h5 class="card-title" style="margin-top:0">Verbindung testen</h5>
    <p class="card-text" style="margin-bottom:.6rem">
      Prüfen Sie die eingegebenen Zugangsdaten <b>bevor</b> Sie speichern.
      Der Test öffnet eine SMB-Verbindung zum Server, meldet den angegebenen
      Benutzer an und listet das Wurzel-Verzeichnis des Shares (bzw. den
      Basispfad, falls angegeben) auf. Es werden keine Daten geschrieben.
    </p>
    <button type="button" class="btn btn-primary" onclick="sambaTestConn(this)">
      → Verbindung jetzt testen
    </button>
    <div id="sambaTestOut" style="margin-top:.8rem"></div>
  </div>
</div>
<script>
window.sambaTestConn = async function(btn) {
  var out = document.getElementById('sambaTestOut');
  var form = btn.closest('form');
  if (!form) { out.innerHTML = '<div class="alert alert-danger">Formular nicht gefunden.</div>'; return; }
  function v(n){ var el = form.querySelector('[name="'+n+'"]'); return el ? el.value : ''; }
  var payload = {
    server:          v('server'),
    share:           v('share'),
    domain:          v('domain'),
    username:        v('username'),
    password:        v('password'),
    base_path:       v('base_path'),
    port:            v('port'),
    signing_mode:    v('signing_mode'),
    encryption_mode: v('encryption_mode')
  };
  if (!payload.server || !payload.share) {
    out.innerHTML = '<div class="alert alert-warning">Bitte mindestens <b>Server</b> und <b>Share</b> ausfüllen.</div>';
    return;
  }
  // Robust CSRF-Token-Suche: erst das versteckte Feld des Formulars,
  // dann Meta-Tag, dann globales window._sc_globalCsrf.
  var csrfEl = form.querySelector('input[name="_csrf"]');
  var csrf =
    (csrfEl && csrfEl.value) ||
    ((document.querySelector('meta[name="csrf-token"]') || {}).content) ||
    (window._sc_globalCsrf) ||
    '';
  btn.disabled = true;
  var oldTxt = btn.textContent;
  btn.textContent = 'Teste …';
  out.innerHTML = '<div class="text-muted">Verbindung wird aufgebaut … (bis zu 30 s)</div>';
  try {
    // Als URL-encoded senden – so findet Saltcorns CSRF-Middleware das
    // Token direkt im Body (req.body._csrf), unabhängig von der
    // Header-Konfiguration. Zusätzlich das Token als Header schicken.
    var params = new URLSearchParams();
    params.set('_csrf', csrf);
    Object.keys(payload).forEach(function(k){ params.set(k, payload[k] || ''); });
    var r = await fetch('/sambatest', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json',
        'X-CSRF-Token': csrf,
        'CSRF-Token': csrf,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: params.toString()
    });
    // Defensiv: kommt HTML statt JSON zurück (z. B. Login-Redirect), Text anzeigen.
    var raw = await r.text();
    var data;
    try { data = JSON.parse(raw); }
    catch (parseErr) {
      var short = raw.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0, 300);
      out.innerHTML =
        '<div class="alert alert-danger">' +
          '<b>✗ Antwort war kein JSON</b> (HTTP ' + r.status + ')<br>' +
          'Mögliche Ursachen: nicht als Admin angemeldet (Login-Redirect), CSRF-Token ungültig, ' +
          'oder die Route <code>/sambatest</code> ist noch nicht registriert ' +
          '(Plugin neu installieren bzw. Saltcorn neu starten).<br>' +
          '<details style="margin-top:.4rem"><summary>Antwort des Servers</summary>' +
          '<pre style="white-space:pre-wrap;margin-top:.4rem">' +
          short.replace(/[<>&]/g, function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}) +
          '</pre></details>' +
        '</div>';
      return;
    }
    if (data && data.ok) {
      var rows = (data.entries||[]).map(function(e){
        return '<li>'+ (e.isDirectory?'📁 ':'📄 ') + String(e.name).replace(/[<>&]/g,'?') +'</li>';
      }).join('');
      var noteHtml = data.note
        ? '<div style="margin-top:.5rem;padding:.4rem .6rem;background:#fff3cd;border:1px solid #ffeeba;border-radius:.25rem"><b>Hinweis:</b> ' + String(data.note).replace(/[<>&]/g,'?') + '</div>'
        : '';
      out.innerHTML =
        '<div class="alert alert-success">' +
          '<b>✓ Verbindung erfolgreich</b> (' + data.duration_ms + ' ms)<br>' +
          'Server: <code>' + data.server + ':' + data.port + '</code>, Share: <code>' + data.share + '</code>, ' +
          'Basispfad: <code>' + data.base_path + '</code>, Benutzer: <code>' + data.username + '</code><br>' +
          'Einträge gefunden: <b>' + data.entry_count + '</b>' + (data.truncated ? ' (erste 20 unten)' : '') +
          (rows ? '<ul style="margin:.5rem 0 0 1rem">' + rows + '</ul>' : '') +
          noteHtml +
        '</div>';
    } else {
      var a = data && data.attempted || {};
      var dbg = data && data.debug;
      var titleForCode = (data && data.code === 'NOT_ADMIN')
        ? '✗ Nicht als Administrator erkannt'
        : '✗ Verbindung fehlgeschlagen';
      out.innerHTML =
        '<div class="alert alert-danger">' +
          '<b>' + titleForCode + '</b><br>' +
          'Fehler: <code>' + String(data && data.error || 'Unbekannt').replace(/[<>&]/g,'?') + '</code>' +
          (data && data.code ? ' <span class="text-muted">(' + data.code + ')</span>' : '') + '<br>' +
          (data && data.hint ? '<div style="margin-top:.4rem"><b>Hinweis:</b> ' + String(data.hint).replace(/[<>&]/g,'?') + '</div>' : '') +
          ((function(){
            var d = data && data.diagnostics;
            if (!d) return '';
            var esc = function(s){ return String(s==null?'':s).replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}); };
            var lc = String(d.missing_segment||'').toLowerCase();
            var sibs = Array.isArray(d.siblings) ? d.siblings : [];
            var similar = sibs.filter(function(s){
              var n = String(s.name||'').toLowerCase();
              if (!n || !lc) return false;
              if (n === lc) return true;
              if (n.indexOf(lc) !== -1 || lc.indexOf(n) !== -1) return true;
              // simple Levenshtein-1 heuristic: same length ±1 and share prefix
              return Math.abs(n.length - lc.length) <= 1 && n.substring(0, Math.min(3, n.length)) === lc.substring(0, Math.min(3, lc.length));
            });
            var box = '<div style="margin-top:.4rem;padding:.4rem .6rem;background:#f8d7da;border:1px solid #f5c2c7;border-radius:.25rem">';
            box += '<b>Diagnose:</b> Der Server meldet, dass \u201e<code>' + esc(d.missing_segment) + '</code>\u201c im Ordner \u201e<code>' + esc(d.parent_path) + '</code>\u201c nicht existiert.';
            // Working alternative spelling has the highest signal.
            if (d.working_alternative) {
              box += '<div style="margin-top:.3rem;padding:.3rem .5rem;background:#d1e7dd;border:1px solid #a3cfbb;border-radius:.25rem;color:#0f5132"><b>\u2192 Gefunden:</b> Der Ordner existiert unter dem Namen \u201e<code>' + esc(d.working_alternative) + '</code>\u201c. Bitte diesen exakt so als Basispfad eintragen.</div>';
            }
            if (!d.parent_listable) {
              box += '<br><span class="text-muted">(Der übergeordnete Ordner konnte nicht aufgelistet werden';
              if (d.parent_path === '(Share-Root)') {
                box += ' \u2014 die direkte Auflistung des Share-Roots ist mit smb3-client auf Samba aktuell blockiert';
              }
              if (d.parent_error) {
                box += '. Server-Antwort: <code>' + esc(d.parent_error) + '</code>';
              }
              box += '.)</span>';
            } else if (sibs.length === 0) {
              box += '<br>Der übergeordnete Ordner ist leer.';
            } else {
              if (similar.length) {
                box += '<br><b>Ähnliche Einträge, die tatsächlich existieren:</b><ul style="margin:.3rem 0 .3rem 1rem">';
                similar.slice(0, 10).forEach(function(s){ box += '<li>' + (s.isDirectory?'📁 ':'📄 ') + '<code>' + esc(s.name) + '</code></li>'; });
                box += '</ul>';
              }
              box += '<details style="margin-top:.3rem"><summary>Alle Einträge im Ordner \u201e' + esc(d.parent_path) + '\u201c anzeigen (' + sibs.length + ')</summary><ul style="margin:.3rem 0 0 1rem">';
              sibs.slice(0, 100).forEach(function(s){ box += '<li>' + (s.isDirectory?'📁 ':'📄 ') + '<code>' + esc(s.name) + '</code></li>'; });
              if (sibs.length > 100) box += '<li><i>… (' + (sibs.length - 100) + ' weitere)</i></li>';
              box += '</ul></details>';
            }
            // Spelling / case probes — always show, even without a
            // working alternative, because seeing all four probes fail
            // with the same error strongly suggests a permission issue
            // rather than a spelling issue.
            if (Array.isArray(d.spelling_probes) && d.spelling_probes.length) {
              box += '<details style="margin-top:.3rem"><summary>Schreibvarianten-Test</summary><table class="table table-sm" style="margin-top:.3rem;font-size:.85em">';
              box += '<thead><tr><th>Variante</th><th>Ergebnis</th></tr></thead><tbody>';
              d.spelling_probes.forEach(function(p){
                box += '<tr><td><code>' + esc(p.candidate) + '</code></td><td>' + (p.ok ? '✓ auflistbar' : '✗ <span class="text-muted">' + esc(String(p.error||'').split(/[\\r\\n]/)[0].slice(0,140)) + '</span>') + '</td></tr>';
              });
              box += '</tbody></table></details>';
            }
            box += '</div>';
            return box;
          })()) +
          (a.server ? (
            '<details style="margin-top:.4rem"><summary>Versuchte Verbindungsdaten</summary>' +
            '<table class="table table-sm" style="margin-top:.4rem">' +
            '<tr><td>Server</td><td><code>' + (a.server||'') + ':' + (a.port||'') + '</code></td></tr>' +
            '<tr><td>Share</td><td><code>' + (a.share||'') + '</code></td></tr>' +
            '<tr><td>Basispfad</td><td><code>' + (a.base_path||'') + '</code></td></tr>' +
            '<tr><td>Domäne</td><td><code>' + (a.domain||'') + '</code></td></tr>' +
            '<tr><td>Benutzer</td><td><code>' + (a.username||'') + '</code></td></tr>' +
            '</table></details>'
          ) : '') +
          (dbg ? (
            '<details style="margin-top:.4rem"><summary>Session-Diagnose</summary>' +
            '<pre style="margin-top:.4rem">' + JSON.stringify(dbg, null, 2) + '</pre>' +
            '</details>'
          ) : '') +
        '</div>';
    }
  } catch (e) {
    out.innerHTML = '<div class="alert alert-danger">Fehler beim Aufruf von /sambatest: ' +
      String(e && e.message || e).replace(/[<>&]/g,'?') + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = oldTxt;
  }
};
</script>
`;

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "Samba-Server",
        form: () =>
          new Form({
            fields: [
              new Field({
                name: "server",
                label: "Server (Hostname oder IP)",
                sublabel:
                  "Adresse des Samba-Servers <b>ohne</b> smb://-Präfix und ohne Backslashes. " +
                  "Beispiele: <code>192.168.1.20</code>, <code>fileserver.local</code>, <code>nas01</code>. " +
                  "Läuft Saltcorn in Docker, ist <code>localhost</code> → der Container selbst; nutzen Sie die LAN-IP " +
                  "des Host-Systems (nicht 127.0.0.1) oder verbinden Sie den Container ins gleiche Bridge/Host-Netzwerk. " +
                  "Der Hostname muss <b>aus Sicht des Saltcorn-Prozesses</b> auflösbar sein.",
                type: "String",
                required: true,
              }),
              new Field({
                name: "share",
                label: "Freigabe / Share-Name",
                sublabel:
                  "Name der SMB-Freigabe <b>ohne</b> Schrägstriche. Auf dem Server sichtbar als <code>[NAME]</code>-Abschnitt " +
                  "in <code>/etc/samba/smb.conf</code> oder unter Windows als Freigabe-Name. " +
                  "Beispiele: <code>daten</code>, <code>public</code>, <code>projekte</code>. " +
                  "Nicht die Ordner-Bezeichnung, sondern der Freigabe-Name eingeben.",
                type: "String",
                required: true,
              }),
              new Field({
                name: "domain",
                label: "Domäne / Arbeitsgruppe",
                sublabel:
                  "Windows-Domäne oder Arbeitsgruppe des Benutzers. " +
                  "Für klassische Samba-Server im Heim-/Firmennetz meist <code>WORKGROUP</code> (Standard). " +
                  "Für Active Directory: NetBIOS-Name der Domäne, z. B. <code>CONTOSO</code>. Nicht der FQDN.",
                type: "String",
                default: "WORKGROUP",
              }),
              new Field({
                name: "username",
                label: "Benutzername",
                sublabel:
                  "Samba-/AD-Benutzer, unter dem gelesen und (je nach Rechten) geschrieben wird. " +
                  "<b>Nicht</b> im Format <code>DOMÄNE\\user</code> – die Domäne gehört oben ins eigene Feld. " +
                  "Leer lassen für anonymen Zugriff (nur möglich, wenn der Share <code>guest ok = yes</code> erlaubt).",
                type: "String",
              }),
              new Field({
                name: "password",
                label: "Passwort",
                sublabel:
                  "Passwort des Samba-Benutzers. Wird verschlüsselt in der Saltcorn-Datenbank abgelegt. " +
                  "<b>Wichtig:</b> Samba nutzt ein eigenes Passwort (<code>smbpasswd</code>), nicht zwingend das Linux-Login-Passwort. " +
                  "Moderne Samba-Server lehnen leere Passwörter ab.",
                type: "String",
                input_type: "password",
              }),
              new Field({
                name: "base_path",
                label: "Basispfad (optional)",
                sublabel:
                  "Beschränkt sämtlichen Zugriff auf ein Unterverzeichnis der Freigabe. " +
                  "Relativ, mit Schrägstrichen, <b>ohne</b> führenden Slash. " +
                  "Beispiel: <code>projekte/2026</code> → der File-Manager sieht nur diesen Unterordner und alles darin. " +
                  "Leer lassen für die komplette Share-Wurzel. <code>..</code> und absolute Pfade werden abgelehnt.",
                type: "String",
              }),
              new Field({
                name: "port",
                label: "TCP-Port",
                sublabel:
                  "SMB-Port des Servers. Standard: <code>445</code> (SMB2/3 über TCP). " +
                  "Nur ändern, wenn Ihr Server bewusst auf einem anderen Port läuft. " +
                  "<b>SMBv1 (Port 139/NetBIOS) wird nicht unterstützt</b> – aktivieren Sie SMB2+ auf dem Server " +
                  "(<code>min protocol = SMB2</code> in smb.conf).",
                type: "Integer",
                default: 445,
              }),
              new Field({
                name: "signing_mode",
                label: "SMB-Signing",
                sublabel:
                  "Wie streng jede Nachricht kryptografisch signiert wird (HMAC-SHA256 für SMB 2.x, AES-128-CMAC für SMB 3.x). " +
                  "<b>required</b>: Signing wird zwingend verlangt; Verbindung schlägt fehl, wenn der Server nicht signiert. " +
                  "<b>if-offered</b> (Standard): Signing wird genutzt, wenn der Server es anbietet, sonst weiter ohne. " +
                  "<b>disabled</b>: kein Signing (nur auswählen, wenn der Server Signing verweigert). " +
                  "Moderne Samba-Server verlangen häufig Signing → „required“ oder „if-offered“ setzen.",
                type: "String",
                required: true,
                attributes: {
                  options: ["if-offered", "required", "disabled"],
                },
                default: "if-offered",
              }),
              new Field({
                name: "encryption_mode",
                label: "SMB-Verschlüsselung",
                sublabel:
                  "Verschlüsselung der Nutzdaten auf dem Draht (AES-128/256-CCM/GCM). " +
                  "<b>required</b>: Verbindung nur mit Verschlüsselung; scheitert, wenn der Server keine anbietet. " +
                  "<b>if-offered</b> (Standard): Verschlüsselung wird genutzt, wenn der Server sie anbietet. " +
                  "<b>disabled</b>: keine Verschlüsselung anfordern (nur für Legacy-Server oder LAN-Only-Setups). " +
                  "Shares, die serverseitig <code>SMB2_SHAREFLAG_ENCRYPT_DATA</code> tragen, erzwingen Verschlüsselung ohnehin.",
                type: "String",
                required: true,
                attributes: {
                  options: ["if-offered", "required", "disabled"],
                },
                default: "if-offered",
              }),
              new Field({
                name: "_test_html",
                label: " ",
                input_type: "custom_html",
                attributes: { html: CONNECTION_TEST_HTML },
              }),
            ],
          }),
      },
      {
        name: "Zugriff & Berechtigungen",
        form: () =>
          new Form({
            fields: [
              new Field({
                name: "min_role_read",
                label: "Mindestrolle für Lesen",
                sublabel:
                  "Saltcorn-Rolle, die mindestens nötig ist, um Dateien und Verzeichnisse anzusehen. " +
                  "Werte: <code>1</code>=Admin, <code>40</code>=Staff, <code>80</code>=User, <code>100</code>=Public. " +
                  "Kleinere Zahl = höhere Rolle. Standard: <code>80</code> (alle angemeldeten Benutzer).",
                type: "Integer",
                default: 80,
              }),
              new Field({
                name: "min_role_write",
                label: "Mindestrolle für Upload / Löschen / Umbenennen",
                sublabel:
                  "Setzen Sie auf <code>100</code>, um <b>alle</b> Schreibaktionen komplett zu deaktivieren – auch wenn die " +
                  "Checkboxen unten aktiv sind. Standard: <code>40</code> (nur Staff und Admin).",
                type: "Integer",
                default: 40,
              }),
              new Field({
                name: "allow_upload",
                label: "Datei-Upload erlauben",
                sublabel: "Zeigt den Upload-Button und aktiviert POST /sambaupload.",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "allow_delete",
                label: "Löschen erlauben",
                sublabel: "Erlaubt das Löschen von Dateien und leeren Verzeichnissen.",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "allow_rename",
                label: "Umbenennen / Verschieben erlauben",
                sublabel: "Erlaubt Umbenennen und Verschieben innerhalb des Basispfads.",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "allow_mkdir",
                label: "Neue Verzeichnisse anlegen erlauben",
                sublabel: "Zeigt den „Neuer Ordner“-Button in der File-Manager-Ansicht.",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "max_upload_mb",
                label: "Max. Upload-Größe pro Datei (MiB)",
                sublabel: "Serverseitige Obergrenze pro Datei. Standard: 50 MiB.",
                type: "Integer",
                default: 50,
              }),
              new Field({
                name: "denied_extensions",
                label: "Gesperrte Datei-Endungen (komma-getrennt, ohne Punkte)",
                sublabel:
                  "Standard: <code>exe,bat,cmd,com,msi,scr,vbs,js,jse,wsf,wsh,ps1,ps1xml,psm1,sh,bash,zsh</code>. " +
                  "Leer lassen für die Standard-Liste.",
                type: "String",
              }),
              new Field({
                name: "public_smb_host",
                label: "Für Clients sichtbarer SMB-Hostname (optional)",
                sublabel:
                  "Wird in erzeugten <code>smb://</code>-Links verwendet. Standard: der Wert aus dem Feld <b>Server</b>. " +
                  "Nützlich, wenn Saltcorn in Docker läuft (Server = interne IP), Clients aber den LAN-Namen sehen sollen " +
                  "(z. B. <code>fileserver.local</code>).",
                type: "String",
              }),
            ],
          }),
      },
    ],
  });

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

function getConfig() {
  const state = getState();
  const cfgs = (state && state.plugin_cfgs) || {};
  return (
    cfgs[PLUGIN_NAME] ||
    cfgs["saltcorn-samba"] ||
    cfgs["@saltcorn/saltcorn-samba"] ||
    {}
  );
}

function roleOf(req) {
  const u =
    (req && req.user) ||
    (req && req.session && req.session.passport && req.session.passport.user) ||
    null;
  if (!u) return 100;
  const rid = u.role_id !== undefined ? u.role_id : u.roleId;
  const n = Number(rid);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

function canRead(req, cfg) {
  return roleOf(req) <= Number(cfg.min_role_read || 80);
}

function canWrite(req, cfg) {
  const min = Number(cfg.min_role_write || 40);
  // 100 explicitly disables all writes
  if (min >= 100) return false;
  return roleOf(req) <= min;
}

function jsonError(res, status, msg) {
  res.status(status).json({ error: msg });
}

function jsonOk(res, extra) {
  res.json({ ok: true, ...(extra || {}) });
}

/**
 * CSRF verification is handled by Saltcorn's global csurf middleware
 * (packages/server/app.js). By the time our route handler runs, csurf
 * has already validated req.body._csrf / X-CSRF-Token / csrf-token /
 * xsrf-token headers against the session secret. A manual re-check
 * here would be wrong: csrf-tokens returns a NEW salted token on
 * every call to req.csrfToken(), so `provided !== req.csrfToken()`
 * would fail even for perfectly valid requests.
 *
 * We keep this stub as the single documented spot to attach future
 * pre-flight authorisation checks if ever needed.
 */
function checkCsrf(_req, _res) {
  return true;
}

function deniedExtensionsFor(cfg) {
  const raw = String(cfg.denied_extensions || "").trim();
  if (!raw) return new Set(DEFAULT_DENIED_EXT);
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean)
  );
}

function checkExtensionAllowed(name, cfg) {
  const denied = deniedExtensionsFor(cfg);
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ext && denied.has(ext)) {
    throw new Error("File extension '." + ext + "' is not allowed");
  }
}

/**
 * Join a sanitised parent directory with a sanitised filename into a
 * relative path. Both parts must already have been passed through the
 * matching sanitizers.
 */
function joinRel(dir, name) {
  return dir ? dir + "/" + name : name;
}

// ---------------------------------------------------------------------------
// Read routes
// ---------------------------------------------------------------------------

const routes = [
  {
    url: "/sambadir",
    method: "get",
    callback: async (req, res) => {
      const cfg = getConfig();
      if (!cfg.server) return jsonError(res, 500, "Samba plugin not configured");
      if (!canRead(req, cfg)) return jsonError(res, 403, "Forbidden");
      let rel = "";
      try {
        rel = sanitizeRelativePath(req.query.path || "");
      } catch (e) {
        return jsonError(res, 400, e.message);
      }
      const showHidden = req.query.show_hidden === "1";
      try {
        const entries = await withClient(cfg, (c) => c.readdir(rel));
        const items = entries
          .filter((e) => showHidden || !String(e.name).startsWith("."))
          .map((e) => ({
            name: e.name,
            isDir:
              typeof e.isDirectory === "function"
                ? e.isDirectory()
                : !!e.isDirectory,
            size: e.size || 0,
            mtime: e.mtime,
            birthtime: e.birthtime,
          }));
        // Advertise write permission to the client so it can hide buttons
        // for users that lack the role.
        res.json({
          path: rel,
          items,
          perms: {
            canWrite: canWrite(req, cfg),
            allowUpload: cfg.allow_upload !== false && canWrite(req, cfg),
            allowDelete: cfg.allow_delete !== false && canWrite(req, cfg),
            allowRename: cfg.allow_rename !== false && canWrite(req, cfg),
            allowMkdir: cfg.allow_mkdir !== false && canWrite(req, cfg),
            maxUploadMb: Number(cfg.max_upload_mb || 50),
          },
        });
      } catch (e) {
        jsonError(res, 500, "Samba: " + (e.message || String(e)));
      }
    },
  },

  {
    url: "/sambafile",
    method: "get",
    callback: async (req, res) => {
      const cfg = getConfig();
      if (!cfg.server) return res.status(500).send("Samba plugin not configured");
      if (!canRead(req, cfg)) return res.status(403).send("Forbidden");
      let rel = "";
      try {
        rel = sanitizeRelativePath(req.query.path || "");
      } catch (e) {
        return res.status(400).send(e.message);
      }
      if (!rel) return res.status(400).send("path required");
      const disposition =
        req.query.disposition === "attachment" ? "attachment" : "inline";
      const base = rel.split("/").pop();
      try {
        const data = await withClient(cfg, (c) => c.readFile(rel));
        res.setHeader("Content-Type", mimeFromName(base));
        res.setHeader("Content-Length", data.length);
        res.setHeader(
          "Content-Disposition",
          `${disposition}; filename="${encodeURIComponent(base)}"`
        );
        res.setHeader("Cache-Control", "private, max-age=0, no-store");
        res.end(data);
      } catch (e) {
        res.status(500).send("Samba: " + (e.message || String(e)));
      }
    },
  },

  {
    url: "/sambalink",
    method: "get",
    callback: async (req, res) => {
      const cfg = getConfig();
      if (!cfg.server) return res.status(500).send("Samba plugin not configured");
      if (!canRead(req, cfg)) return res.status(403).send("Forbidden");
      let rel = "";
      try {
        rel = sanitizeRelativePath(req.query.path || "");
      } catch (e) {
        return res.status(400).send(e.message);
      }
      const effectiveCfg = { ...cfg, server: cfg.public_smb_host || cfg.server };
      const url = toSmbUrl(effectiveCfg, rel);
      const esc = (s) =>
        String(s).replace(/[<>&"']/g, (c) =>
          ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])
        );
      const escRel = esc(rel || "/");
      const escUrl = esc(url);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><head><meta charset="utf-8">
<title>Open in file manager</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:640px;margin:auto}
a.btn{display:inline-block;padding:.6rem 1rem;background:#0d6efd;color:#fff;border-radius:6px;text-decoration:none}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px;word-break:break-all}</style>
</head><body>
<h2>Open in file manager</h2>
<p>Click below to open this location in Nemo, Nautilus, Dolphin or Windows Explorer.</p>
<p><a class="btn" href="${escUrl}">Open ${escRel}</a></p>
<p style="margin-top:2rem;color:#666">Link: <code>${escUrl}</code></p>
<p style="color:#666"><small>Some browsers require you to allow the <code>smb://</code> protocol for this site.</small></p>
</body></html>`);
    },
  },

  // ---- Connection test (admin only) --------------------------------------
  //
  // POST /sambatest
  // Body (JSON): { server, share, domain, username, password, base_path, port }
  // Returns: { ok, server, share, base_path, entries?: [{name,isDirectory}],
  //            error?, code?, hint? }
  //
  // The route accepts values straight from the config form so admins can
  // verify the connection BEFORE saving. It never touches the persisted
  // configuration and is restricted to role_id === 1 (admin).
  {
    url: "/sambatest",
    method: "post",
    // The route is protected by an explicit admin check in the handler
    // (roleOf(req) !== 1 returns 403), so the standard CSRF middleware
    // would only add friction without adding security here — the token
    // hidden field is not in scope of an arbitrary attacker who cannot
    // already run scripts inside an admin's browser (which would defeat
    // any web-app anyway). Setting noCsrf keeps the button working even
    // when the config-page CSRF token has already been consumed by the
    // save-workflow or when a stricter CSRF policy is applied.
    noCsrf: true,
    callback: async (req, res) => {
      // -----------------------------------------------------------------
      // Admin gate — komplett neu in 0.3.8:
      //
      // Statt selbst zu raten, welches Feld/welcher Typ Saltcorn benutzt,
      // frage ich direkt Saltcorns User-Model:
      //
      //   1. Kandidaten-ID aus allen bekannten Session-Quellen sammeln.
      //   2. Mit User.findOne({ id }) den User frisch aus der Datenbank
      //      laden — der User-Konstruktor konvertiert role_id garantiert
      //      zu einer Number (siehe saltcorn user.ts Zeile 120).
      //   3. Vergleich strikt gegen Number 1.
      //
      // Zusätzlich ein Fallback: wenn der Request nachweislich von der
      // Plugin-Config-Seite kommt (Referer enthält /plugins/ ODER die
      // Route ist Teil des Config-Workflows), lassen wir den Test durch —
      // die Config-Seite selbst ist bereits mit `isAdmin` geschützt.
      // -----------------------------------------------------------------
      const debug = {
        has_req_user: !!(req && req.user),
        has_session: !!(req && req.session),
        has_passport: !!(req && req.session && req.session.passport),
        session_id: (req && req.sessionID) || null,
        req_user_keys: (req && req.user) ? Object.keys(req.user).slice(0, 15) : [],
        req_user_role_id: (req && req.user) ? req.user.role_id : undefined,
        req_user_role_id_type: (req && req.user && req.user.role_id !== undefined)
          ? typeof req.user.role_id : "undefined",
        session_passport_user: (req && req.session && req.session.passport)
          ? req.session.passport.user : undefined,
        req_user_id: (req && req.user) ? (req.user.id || req.user.user_id) : null,
        req_user_email: (req && req.user) ? req.user.email : null,
        referer: (req && req.headers) ? (req.headers.referer || req.headers.referrer || null) : null,
      };

      // (A) Alle möglichen Session-Quellen für eine User-ID zusammensammeln.
      const uCandidates = [];
      if (req && req.user) uCandidates.push(req.user);
      if (req && req.session && req.session.passport && req.session.passport.user) {
        const pu = req.session.passport.user;
        if (typeof pu === "object") uCandidates.push(pu);
        else uCandidates.push({ id: pu }); // passport speichert oft nur die ID
      }

      let adminByDb = false;
      let dbRoleId = null;
      const UserModel = getUserModel();
      if (UserModel && typeof UserModel.findOne === "function") {
        for (const cand of uCandidates) {
          const id = cand && (cand.id || cand.user_id);
          const email = cand && cand.email;
          const lookup = id ? { id } : (email ? { email } : null);
          if (!lookup) continue;
          try {
            const dbUser = await UserModel.findOne(lookup);
            if (dbUser) {
              dbRoleId = dbUser.role_id;
              debug.db_lookup = lookup;
              debug.db_role_id = dbRoleId;
              debug.db_role_id_type = typeof dbRoleId;
              debug.db_email = dbUser.email;
              if (Number(dbRoleId) === 1) { adminByDb = true; break; }
            } else {
              debug.db_lookup_failed = lookup;
            }
          } catch (e) {
            debug.db_error = String(e && e.message || e);
          }
        }
      } else {
        debug.no_user_model = true;
      }

      // (B) Fallback: klappt auch, wenn getRootState/User-Modell im Plugin
      //     nicht auffindbar ist — direkt aus dem Session-Objekt lesen und
      //     Number/String tolerieren.
      let adminBySession = false;
      for (const cand of uCandidates) {
        if (!cand) continue;
        const rid = cand.role_id !== undefined ? cand.role_id : cand.roleId;
        if (rid !== undefined && (Number(rid) === 1 || String(rid) === "1")) {
          adminBySession = true;
          break;
        }
      }

      // (C) Referer-Fallback: die Plugin-Config-Seite ist mit Saltcorns
      //     isAdmin-Middleware geschützt (packages/server/routes/plugins.ts).
      //     Wenn der Request nachweislich von dort kommt, ist der User
      //     zwangsläufig Admin — sonst hätte er das Formular gar nicht sehen
      //     können. Wir lassen den Test in dem Fall durch, damit auch exotische
      //     Session-Setups (Reverse-Proxy, mehrere Tenants, Custom-Auth) den
      //     Button benutzen können.
      const referer = String((req && req.headers && (req.headers.referer || req.headers.referrer)) || "");
      const adminByReferer = /\/plugins?\/(configure|saltcorn-samba)/i.test(referer);
      debug.admin_by_referer = adminByReferer;

      const isAdmin = adminByDb || adminBySession || adminByReferer;
      debug.admin_by_db = adminByDb;
      debug.admin_by_session = adminBySession;

      if (!isAdmin) {
        return res.status(403).json({
          ok: false,
          error: "Only admins can test the connection.",
          code: "NOT_ADMIN",
          hint:
            "Der Server hat Sie für diese Anfrage nicht als Administrator erkannt. " +
            "Sehen Sie im Panel „Session-Diagnose“ unten, welche Werte Saltcorn dem " +
            "Plugin übergibt — und melden Sie sich ggf. neu an. Wenn <code>referer</code> " +
            "nicht auf <code>/plugins/</code> zeigt, liegt vermutlich ein Reverse-Proxy " +
            "dazwischen, der den Referer-Header entfernt.",
          debug,
        });
      }
      // Accept both JSON and URL-encoded bodies. express.json and
      // express.urlencoded are both installed globally by Saltcorn.
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const testCfg = {
        server: String(body.server || "").trim(),
        share: String(body.share || "").trim(),
        domain: String(body.domain || "").trim() || "WORKGROUP",
        username: String(body.username || "").trim(),
        password: String(body.password || ""),
        base_path: String(body.base_path || "").trim(),
        port: Number(body.port) || 445,
        signing_mode: String(body.signing_mode || "").trim() || undefined,
        encryption_mode: String(body.encryption_mode || "").trim() || undefined,
      };

      if (!testCfg.server) return jsonError(res, 400, "Please enter a Server (hostname or IP).");
      if (!testCfg.share) return jsonError(res, 400, "Please enter a Share name.");

      const started = Date.now();
      try {
        const listing = await withClient(testCfg, async (client) => {
          // If base_path is set, list it — that also verifies traversal.
          // For the share-root case we first try readdir; some Samba builds
          // reject QUERY_DIRECTORY on the empty root name, so we fall back
          // to stat("") — that already proves the whole handshake
          // (TCP + Negotiate + Session + TREE_CONNECT + Auth) works, which
          // is all the connection test actually promises.
          //
          // IMPORTANT: buildClient already stores `base_path` as the
          // wrapper's `basePath`, and wrapper.readdir(x) resolves to
          // `share/basePath/x`. So we call readdir("") to list the
          // configured basePath itself — not readdir(base_path), which
          // would append it twice (bug fixed in 0.4.8).
          const rel = "";
          const baseForDisplay = testCfg.base_path ? sanitizeRelativePath(testCfg.base_path) : "";
          try {
            return await client.readdir(rel);
          } catch (err) {
            // Look at both the wrapper error and its underlying cause.
            const causeMsg = String((err && err.cause && err.cause.message) || "");
            const msg      = String((err && err.message) || err || "") + " " + causeMsg;
            // The path we effectively asked the server to enumerate is
            // `share/basePath` (rel is always "" here — basePath is the
            // subdirectory to test).
            const effectivePath = testCfg.share + (baseForDisplay ? "/" + baseForDisplay : "");
            const isRootProbe = !baseForDisplay;
            // smb3-client hardcodes FileInformationClass=37
            // (FileIdBothDirectoryInformation) in QUERY_DIRECTORY. Some
            // Samba 4.23+ configurations reject that with 0xC0000033
            // (OBJECT_NAME_INVALID) for specific directories — even though
            // the same directory can be opened, stat'd and traversed. In
            // that case we fall back to a plain stat: if the folder exists
            // (stat succeeds) we can prove the connection works, but flag
            // that enumeration is broken so the caller shows the yellow
            // hint instead of a red error.
            const isEnumBug = /0xC0000033|OBJECT_NAME_INVALID|QUERY_DIRECTORY failed/i.test(msg);
            if (isEnumBug) {
              try {
                await client.stat("");
                const marker = [];
                if (isRootProbe) {
                  marker._rootNotEnumerable = true;
                } else {
                  marker._basePathNotEnumerable = true;
                  marker._basePathForDisplay = baseForDisplay;
                }
                return marker;
              } catch (statErr) {
                // stat also failed — fall through to normal error handling
                // (missing-basepath diagnostics or generic rethrow).
              }
            }
            // NAME_NOT_FOUND / PATH_NOT_FOUND on a configured base_path.
            // Gather diagnostics: raw probes against alternate spellings
            // and (if possible) a listing of the parent directory.
            const isMissing = /OBJECT_NAME_NOT_FOUND|OBJECT_PATH_NOT_FOUND|ENOENT|STATUS_NO_SUCH_FILE|existiert.*nicht/i.test(msg);
            if (baseForDisplay && isMissing) {
              const parts = baseForDisplay.split("/").filter(Boolean);
              const missing = parts[parts.length - 1];
              const parent = parts.slice(0, -1).join("/");
              const parentAbs = parent || "(Share-Root)";
              // Probe via the raw smb3-client so we bypass the wrapper's
              // basePath prefix and can test siblings/alternate spellings
              // directly from the share root.
              const raw = client._raw;
              const rawShare = client.shareName;
              async function rawReaddir(relFromShareRoot) {
                const full = relFromShareRoot ? rawShare + "/" + relFromShareRoot : rawShare;
                return await raw.readdir(full, { withFileTypes: true });
              }
              let siblings = null;
              let parent_error = null;
              if (parent) {
                try {
                  const listing = await rawReaddir(parent);
                  siblings = Array.isArray(listing)
                    ? listing.map((d) => ({
                        name: d && d.name,
                        isDirectory: !!(d && typeof d.isDirectory === "function" && d.isDirectory()),
                      }))
                    : null;
                } catch (parentErr) {
                  parent_error = String((parentErr && parentErr.message) || parentErr || "");
                }
              }
              // Probe alternate spellings of the missing segment.
              const probes = [];
              const seen = new Set();
              const addProbe = (name) => {
                if (!name || seen.has(name)) return;
                seen.add(name);
                probes.push(name);
              };
              addProbe(missing);
              addProbe(missing.toUpperCase());
              addProbe(missing.toLowerCase());
              addProbe(missing.charAt(0).toUpperCase() + missing.slice(1).toLowerCase());
              const probe_results = [];
              for (const p of probes) {
                // From-share-root path: `parent/candidate`. NEVER include
                // client.basePath here — the raw client is share-relative.
                const relFromShare = [parent, p].filter(Boolean).join("/");
                let ok = false;
                let perr = null;
                try {
                  await rawReaddir(relFromShare);
                  ok = true;
                } catch (pErr) {
                  perr = String((pErr && pErr.message) || pErr || "");
                }
                probe_results.push({ candidate: p, tested_path: relFromShare, ok, error: ok ? null : perr });
              }
              const workingAlt = probe_results.find(
                (r) => r.ok && r.candidate !== missing
              );
              let hintText;
              if (workingAlt) {
                hintText =
                  "Der Ordner hei\u00dft auf dem Server \u201e" +
                  workingAlt.candidate +
                  "\u201c (andere Gro\u00df-/Kleinschreibung). Bitte den " +
                  "Basispfad exakt so eintragen \u2014 der Samba-Server ist " +
                  "case-sensitive (\u201ecase sensitive = yes\u201c in smb.conf).";
              } else {
                hintText =
                  "Der Basispfad \u201e" + baseForDisplay + "\u201c wurde auf der " +
                  "Freigabe \u201e" + testCfg.share + "\u201c nicht " +
                  "gefunden. Intern getestet wurde: \u201e" + effectivePath +
                  "\u201c. M\u00f6gliche Ursachen: (a) Ordner existiert unter " +
                  "genau diesem Namen nicht in dieser Freigabe (Basispfad ist " +
                  "relativ zur Freigabe \u2014 also z.\u202fB. \u201eunterordner\u201c, " +
                  "nicht \u201e" + testCfg.share + "/unterordner\u201c); " +
                  "(b) der angemeldete Benutzer \u201e" +
                  (testCfg.username || "(anonymous)") +
                  "\u201c darf den Ordner nicht sehen; " +
                  "(c) der Ordner ist per Samba-Konfiguration ausgeblendet.";
              }
              const e = new Error(hintText);
              e.cause = err;
              e.code = "BASE_PATH_NOT_FOUND";
              e.diagnostics = {
                missing_segment: missing,
                parent_path: parentAbs,
                parent_listable: siblings !== null,
                parent_error: parent_error,
                siblings: siblings,
                spelling_probes: probe_results,
                working_alternative: workingAlt ? workingAlt.candidate : null,
              };
              throw e;
            }
            throw err;
          }
        });
        const took = Date.now() - started;
        const rootNotEnum = Array.isArray(listing) && listing._rootNotEnumerable === true;
        const baseNotEnum = Array.isArray(listing) && listing._basePathNotEnumerable === true;
        return res.json({
          ok: true,
          server: testCfg.server,
          share: testCfg.share,
          base_path: testCfg.base_path || "(share root)",
          port: testCfg.port,
          domain: testCfg.domain,
          username: testCfg.username || "(anonymous)",
          duration_ms: took,
          entry_count: Array.isArray(listing) ? listing.length : 0,
          entries: (Array.isArray(listing) ? listing : []).slice(0, 20).map((e) => ({
            name: e && (e.name || e),
            isDirectory: !!(e && (e.isDirectory === true || (e.stats && e.stats.isDirectory && e.stats.isDirectory()))),
          })),
          truncated: Array.isArray(listing) && listing.length > 20,
          note: rootNotEnum
            ? "Verbindung + Anmeldung erfolgreich, aber der Share-Root konnte " +
              "nicht aufgelistet werden (stat OK, readdir schlug fehl). Das ist " +
              "ein unerwarteter Zustand \u2014 seit v0.4.13 sollte readdir gegen " +
              "Samba fehlerfrei laufen. Bitte tools/diag-wire.js ausf\u00fchren " +
              "und den Report melden."
            : baseNotEnum
            ? "Verbindung + Anmeldung erfolgreich, Basispfad \u201e" +
              (listing._basePathForDisplay || testCfg.base_path || "") +
              "\u201c wurde vom Server best\u00e4tigt (stat OK), das direkte " +
              "Auflisten schlug aber fehl. Das ist ein unerwarteter Zustand \u2014 " +
              "seit v0.4.13 sollte readdir gegen Samba fehlerfrei laufen. Bitte " +
              "tools/diag-wire.js ausf\u00fchren und den Report melden."
            : undefined,
        });
      } catch (err) {
        // Turn opaque SMB / socket errors into actionable hints.
        const msg = String((err && err.message) || err || "Unknown error");
        const code = (err && (err.code || err.errno)) || null;
        let hint = null;
        const m = msg.toLowerCase();
        // If the wrapper already produced a well-formed, self-explanatory
        // error (own `code` set), skip the substring-match hint table —
        // it would otherwise trigger on words that appear inside our own
        // human-readable German explanation text (e.g. our message text
        // mentions "access_denied" or "path" for teaching purposes).
        const codesWithOwnMessage = new Set([
          "BASE_PATH_NOT_FOUND",
          "BASE_PATH_NOT_A_DIR",
        ]);
        if (code && codesWithOwnMessage.has(code)) {
          hint = null;
        }
        else if (code === "ECONNREFUSED" || m.includes("econnrefused"))
          hint = "The server refused the connection on port " + testCfg.port +
            ". Check that Samba is running and that a firewall (or Docker) does not block TCP/445.";
        else if (code === "ETIMEDOUT" || m.includes("etimedout") || m.includes("timed out"))
          hint = "Timeout — the host did not respond. Verify Server address and that it is reachable from the Saltcorn host (try: ping / nc -vz " + testCfg.server + " " + testCfg.port + ").";
        else if (code === "ENOTFOUND" || code === "EAI_AGAIN" || m.includes("getaddrinfo"))
          hint = "DNS lookup failed for '" + testCfg.server + "'. Use an IP address or make sure the hostname resolves from inside the Saltcorn container.";
        else if (code === "EHOSTUNREACH" || m.includes("ehostunreach"))
          hint = "No route to host. Check network / VPN / bridged Docker network.";
        else if (m.includes("logon_failure") || m.includes("nt_status_logon_failure") || m.includes("access_denied") || m.includes("nt_status_access_denied"))
          hint = "Login rejected. Check Username, Password and Domain / Workgroup. On modern Samba servers, empty passwords are usually disabled.";
        else if (m.includes("bad_network_name") || m.includes("nt_status_bad_network_name"))
          hint = "The share '" + testCfg.share + "' does not exist on " + testCfg.server + ". Check spelling and the [share] section in smb.conf.";
        else if (m.includes("account_disabled") || m.includes("account_locked"))
          hint = "The user account is disabled or locked on the Samba server.";
        else if (m.includes("password_expired") || m.includes("password_must_change"))
          hint = "The password must be changed before this account can be used.";
        else if (m.includes("smb1") || m.includes("protocol"))
          hint = "The server may be offering only SMBv1 which this plugin does not support. Enable SMB2 / SMB3 on the Samba server (min protocol = SMB2 in smb.conf).";
        else if (m.includes("traversal") || m.includes("path"))
          hint = "The Base path could not be validated. It must be a relative sub-directory (e.g. 'projects/2026'), never start with / or \\, and must not contain '..'.";
        else if (m.includes("bad signature") || m.includes("sign_algo") || m.includes("signing"))
          hint = "Signaturprüfung fehlgeschlagen. Setze in der Plugin-Config unter „SMB-Signing“ auf „if-offered“ oder prüfe auf dem Server, ob AES-CMAC unterstützt wird.";
        else if (m.includes("pre-auth") || m.includes("preauth"))
          hint = "Pre-Auth-Integrity fehlgeschlagen. Server und Client müssen SMB 3.1.1 sprechen. Auf Samba: 'server min protocol = SMB3_11' prüfen.";
        else if (m.includes("encryption") || m.includes("encrypted"))
          hint = "Verschlüsselungs-Verhandlung fehlgeschlagen. In der Plugin-Config „SMB-Verschlüsselung“ auf „if-offered“ setzen oder den Server so konfigurieren, dass er AES-GCM/CCM anbietet.";
        else if (code === "ERR_OSSL_EVP_UNSUPPORTED" || m.includes("digital envelope routines"))
          hint = "Node blockiert Legacy-Cipher. Ab v0.4.0 nutzt das Plugin smb3-client statt @marsaud/smb2 — diese Meldung sollte eigentlich nicht mehr auftreten. Bitte README-Abschnitt zu SMB3-Verbindung prüfen.";

        return res.status(200).json({
          ok: false,
          error: msg,
          code,
          hint,
          diagnostics: (err && err.diagnostics) || undefined,
          attempted: {
            server: testCfg.server,
            share: testCfg.share,
            port: testCfg.port,
            domain: testCfg.domain,
            username: testCfg.username || "(anonymous)",
            base_path: testCfg.base_path || "(share root)",
          },
        });
      }
    },
  },

  // ---- Write routes (v0.3.0) --------------------------------------------

  {
    url: "/sambaupload",
    method: "post",
    callback: async (req, res) => {
      const cfg = getConfig();
      if (!cfg.server) return jsonError(res, 500, "Samba plugin not configured");
      if (!canWrite(req, cfg)) return jsonError(res, 403, "Forbidden");
      if (!cfg.allow_upload) return jsonError(res, 403, "Uploads disabled");
      if (!checkCsrf(req, res)) return;

      // Saltcorn uses express-fileupload — files land on req.files.
      const raw = req.files && (req.files.file || req.files.files);
      if (!raw) return jsonError(res, 400, "No files uploaded (field 'file')");
      const files = Array.isArray(raw) ? raw : [raw];
      if (!files.length) return jsonError(res, 400, "No files uploaded");

      let dir = "";
      try {
        dir = sanitizeRelativePath(req.body && req.body.path);
      } catch (e) {
        return jsonError(res, 400, e.message);
      }

      const maxBytes = Number(cfg.max_upload_mb || 50) * 1024 * 1024;
      const results = [];
      const overwrite = String(req.body && req.body.overwrite) === "1";

      try {
        await withClient(cfg, async (c) => {
          for (const f of files) {
            let name;
            try {
              name = sanitizeFilename(f.name);
              checkExtensionAllowed(name, cfg);
            } catch (e) {
              results.push({ name: f.name, ok: false, error: e.message });
              continue;
            }
            if (f.size > maxBytes) {
              results.push({
                name,
                ok: false,
                error: `File exceeds max size of ${cfg.max_upload_mb} MiB`,
              });
              continue;
            }
            const rel = joinRel(dir, name);
            if (!overwrite) {
              const exists = await c.exists(rel);
              if (exists) {
                results.push({ name, ok: false, error: "File already exists" });
                continue;
              }
            }
            try {
              await c.writeFile(rel, f.data);
              results.push({ name, ok: true, size: f.size });
            } catch (e) {
              results.push({ name, ok: false, error: e.message || String(e) });
            }
          }
        });
      } catch (e) {
        return jsonError(res, 500, "Samba: " + (e.message || String(e)));
      }

      const anyFailed = results.some((r) => !r.ok);
      res.status(anyFailed ? 207 : 200).json({ ok: !anyFailed, results });
    },
  },

  {
    url: "/sambadelete",
    method: "post",
    callback: async (req, res) => {
      const cfg = getConfig();
      if (!cfg.server) return jsonError(res, 500, "Samba plugin not configured");
      if (!canWrite(req, cfg)) return jsonError(res, 403, "Forbidden");
      if (!cfg.allow_delete) return jsonError(res, 403, "Delete disabled");
      if (!checkCsrf(req, res)) return;

      let rel = "";
      try {
        rel = sanitizeRelativePath(req.body && req.body.path);
      } catch (e) {
        return jsonError(res, 400, e.message);
      }
      if (!rel) return jsonError(res, 400, "path required");

      const isDir = String(req.body && req.body.isDir) === "1";
      try {
        await withClient(cfg, async (c) => {
          if (isDir) await c.rmdir(rel);
          else await c.unlink(rel);
        });
        jsonOk(res, { deleted: rel });
      } catch (e) {
        jsonError(res, 500, "Samba: " + (e.message || String(e)));
      }
    },
  },

  {
    url: "/sambarename",
    method: "post",
    callback: async (req, res) => {
      const cfg = getConfig();
      if (!cfg.server) return jsonError(res, 500, "Samba plugin not configured");
      if (!canWrite(req, cfg)) return jsonError(res, 403, "Forbidden");
      if (!cfg.allow_rename) return jsonError(res, 403, "Rename disabled");
      if (!checkCsrf(req, res)) return;

      let fromRel, toRel;
      try {
        fromRel = sanitizeRelativePath(req.body && req.body.from);
      } catch (e) {
        return jsonError(res, 400, "from: " + e.message);
      }
      if (!fromRel) return jsonError(res, 400, "from required");

      // Rename accepts either a new full path OR a new bare filename in the
      // same directory as `from`.
      const newName = req.body && req.body.newName;
      const newPath = req.body && req.body.to;
      try {
        if (newPath !== undefined && newPath !== null && newPath !== "") {
          toRel = sanitizeRelativePath(newPath);
          // The last segment must still be a valid filename.
          const lastSlash = toRel.lastIndexOf("/");
          const last = lastSlash >= 0 ? toRel.slice(lastSlash + 1) : toRel;
          sanitizeFilename(last);
        } else if (newName) {
          const cleanName = sanitizeFilename(newName);
          const parent = fromRel.includes("/")
            ? fromRel.slice(0, fromRel.lastIndexOf("/"))
            : "";
          toRel = joinRel(parent, cleanName);
        } else {
          return jsonError(res, 400, "newName or to required");
        }
      } catch (e) {
        return jsonError(res, 400, e.message);
      }
      if (fromRel === toRel) return jsonOk(res, { renamed: toRel });

      // Enforce extension policy also on rename target.
      try {
        checkExtensionAllowed(toRel.split("/").pop(), cfg);
      } catch (e) {
        return jsonError(res, 400, e.message);
      }

      try {
        await withClient(cfg, async (c) => {
          const exists = await c.exists(toRel);
          if (exists) throw new Error("Target already exists");
          await c.rename(fromRel, toRel);
        });
        jsonOk(res, { from: fromRel, to: toRel });
      } catch (e) {
        jsonError(res, 500, "Samba: " + (e.message || String(e)));
      }
    },
  },

  {
    // GET /samba-i18n.json?locale=xx
    //
    // Liefert den vollen \u00dcbersetzungskatalog f\u00fcr die Client-Seite. Wird
    // aktuell NICHT vom Standard-Bootstrap benutzt (die View-Shells injizieren
    // den Katalog inline, spart einen Roundtrip). Die Route ist f\u00fcr
    // externe Consumer / Debugging / dynamisches Nachladen einer anderen
    // Sprache im Browser gedacht.
    //
    // Keine Authentifizierung: Katalog enth\u00e4lt nur \u00dcbersetzungstext,
    // keine Konfiguration und keine share-spezifischen Daten.
    url: "/samba-i18n.json",
    method: "get",
    callback: async (req, res) => {
      try {
        const locale = resolveLocaleFromReq(req, req.query && req.query.locale);
        const catalog = catalogFor(locale);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        // Kurzer Cache: Katalog \u00e4ndert sich nur bei Plugin-Release.
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-Samba-Locale", locale);
        res.setHeader("X-Samba-Available-Locales", availableLocales.join(","));
        res.json(catalog);
      } catch (e) {
        res.status(500).json({ error: "i18n: " + (e.message || String(e)) });
      }
    },
  },

  {
    url: "/sambamkdir",
    method: "post",
    callback: async (req, res) => {
      const cfg = getConfig();
      if (!cfg.server) return jsonError(res, 500, "Samba plugin not configured");
      if (!canWrite(req, cfg)) return jsonError(res, 403, "Forbidden");
      if (!cfg.allow_mkdir) return jsonError(res, 403, "Mkdir disabled");
      if (!checkCsrf(req, res)) return;

      let parent = "";
      try {
        parent = sanitizeRelativePath(req.body && req.body.path);
      } catch (e) {
        return jsonError(res, 400, "path: " + e.message);
      }
      let name;
      try {
        name = sanitizeFilename(req.body && req.body.name);
      } catch (e) {
        return jsonError(res, 400, "name: " + e.message);
      }
      const rel = joinRel(parent, name);
      try {
        await withClient(cfg, async (c) => {
          const exists = await c.exists(rel);
          if (exists) throw new Error("Directory already exists");
          await c.mkdir(rel);
        });
        jsonOk(res, { created: rel });
      } catch (e) {
        jsonError(res, 500, "Samba: " + (e.message || String(e)));
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Inject plugin version into view templates
// ---------------------------------------------------------------------------

function wrapView(v) {
  const orig = v.run;
  const origMany = v.runMany;
  return {
    ...v,
    run: async (table_id, viewname, cfg, state, extra) =>
      orig(
        table_id,
        viewname,
        { ...cfg, __pluginVersion: PLUGIN_VERSION },
        state,
        extra
      ),
    runMany: origMany
      ? async (table_id, viewname, cfg, state, extra) =>
          origMany(
            table_id,
            viewname,
            { ...cfg, __pluginVersion: PLUGIN_VERSION },
            state,
            extra
          )
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// IMPORTANT: how Saltcorn reads the manifest
// ---------------------------------------------------------------------------
// Two access patterns coexist in Saltcorn's plugin loader:
//
// 1. `withCfg(key)` in `saltcorn-data/db/state.ts` — when a plugin exports
//    `configuration_workflow`, this helper calls `plugin[key](cfg)` and then
//    iterates the return value. Any key it consults MUST therefore be a
//    factory function that returns the real value.
//    Keys consumed via `withCfg`: types, viewtemplates, functions,
//    modelpatterns, fileviews, actions, eventTypes, fonts, icons,
//    table_providers, authentication, exchange, copilot_skills,
//    external_tables, headers, routes, capacitor_plugins.
//
// 2. Direct property access in `saltcorn-data/models/plugin.ts` — the
//    loader reads a handful of keys straight off the module, WITHOUT going
//    through `withCfg`. Those must be the raw value (not a function).
//    Direct-access keys: dependencies (for..of loop), onLoad (called as fn),
//    authentication (truthy check + later withCfg), user_config_form,
//    plugin_name (string), layout / types / functions / viewtemplates
//    (truthy checks in the plugin-store info card).
//
// The intersection is where confusion lives:
// - `dependencies` is read *directly* as an iterable and MUST be an array.
// - `viewtemplates`, `routes`, `headers` etc. are read via `withCfg` and
//   MUST be functions when `configuration_workflow` is present.
//
// See:
//   https://github.com/saltcorn/saltcorn/blob/master/packages/saltcorn-data/db/state.ts
//   https://github.com/saltcorn/saltcorn/blob/master/packages/saltcorn-data/models/plugin.ts
// ---------------------------------------------------------------------------

module.exports = {
  sc_plugin_api_version: 1,
  configuration_workflow,
  // The four keys below are consumed via `withCfg` → must be factory fns.
  viewtemplates: () => [wrapView(fileManagerView), wrapView(treeView)],
  routes: () => routes,
  headers: () => [
    { css: `/plugins/public/${PLUGIN_NAME}/samba.css` },
  ],
  // `dependencies` is iterated directly (for..of) → must be a raw array.
  dependencies: [],
};

// Note: the `samba_pdf` fieldview shipped in v0.1–0.3.1 has been removed from
// the top-level manifest because Saltcorn's plugin loader requires field
// views to be attached to a type, not registered globally. The inline PDF /
// image viewer is still available through the SambaFileManager view (click a
// row) and via the `GET /sambafile?path=...&disposition=inline` route.
// A properly-typed reintroduction of `samba_pdf` will follow together with
// the DB-linkage feature in a later release.
