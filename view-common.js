/**
 * saltcorn-samba – gemeinsame Bausteine der beiden Views
 * (SambaFileManager und SambaTree).
 *
 * Bis v0.4.16 lagen computeStartPath(), extractCsrf(), serialiseCatalog(),
 * resolveLocaleAndCatalog() und das Script-Bootstrap in filemanager-view.js
 * UND tree-view.js als Kopie. Mit der Verbindungsauswahl (v0.5.0) wäre
 * noch mehr dupliziert worden – daher dieses Modul.
 *
 * Keine direkten Saltcorn-Abhängigkeiten: Die Field-Klasse wird von außen
 * übergeben, damit die Logik ohne Saltcorn unit-testbar bleibt.
 */

"use strict";

const { sanitizeRelativePath } = require("./smb-client");
const { catalogFor, resolveLocaleFromReq } = require("./i18n");
const {
  DEFAULT_CONNECTION,
  connectionOptions,
  normaliseConnectionName,
} = require("./connections");
const { issueForView } = require("./view-binding");
const { getPluginConfig } = require("./plugin-config");

// ---------------------------------------------------------------------------
// Pfad- und Verbindungsauflösung
// ---------------------------------------------------------------------------

/**
 * Setzt den Startpfad (relativ zum base_path der Verbindung) aus bis zu drei
 * Teilen zusammen:
 *   1. `view_base_path` – statisches Präfix pro View
 *   2. Feldwert der Zeile – nur im Modus "from_field"
 *   3. `extra_subpath`  – statisches Suffix, nur im Modus "from_field"
 * Leere Teile entfallen; das Ergebnis läuft durch sanitizeRelativePath
 * (wirft bei Traversal / absoluten Pfaden).
 */
function computeStartPath(configuration, row) {
  const cfg = configuration || {};
  const parts = [];
  if (cfg.view_base_path) parts.push(String(cfg.view_base_path));
  if (cfg.mode === "from_field" && cfg.path_field && row) {
    const v = row[cfg.path_field];
    if (v) parts.push(String(v));
  }
  if (cfg.mode === "from_field" && cfg.extra_subpath) {
    parts.push(String(cfg.extra_subpath));
  }
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return sanitizeRelativePath(joined);
}

/**
 * Bestimmt die Verbindungs-Kennung einer View-Instanz:
 *   - Ist `connection_field` gesetzt und hat die Zeile dort einen Wert,
 *     gewinnt dieser (z. B. Tabelle „Standorte“ mit Spalte „fileserver“).
 *   - Sonst die statisch gewählte `connection`.
 *   - Sonst "default".
 * Die Existenz der Verbindung prüft der Aufrufer bzw. jede Route erneut.
 */
function resolveViewConnection(configuration, row) {
  const cfg = configuration || {};
  if (cfg.connection_field && row) {
    const fromRow = row[cfg.connection_field];
    if (fromRow !== undefined && fromRow !== null && String(fromRow).trim() !== "") {
      return normaliseConnectionName(fromRow);
    }
  }
  return normaliseConnectionName(cfg.connection || DEFAULT_CONNECTION);
}

/**
 * Konfigurationsfelder „Verbindung“ für beide Views.
 * @param {Function} Field              Saltcorn-Field-Klasse
 * @param {object}   pluginCfg          aktuelle Plugin-Konfiguration
 * @param {string[]} stringFieldOptions Textfelder der Tabelle
 */
function connectionConfigFields(Field, pluginCfg, stringFieldOptions) {
  return [
    new Field({
      name: "connection",
      label: "Samba-Verbindung",
      type: "String",
      required: true,
      default: DEFAULT_CONNECTION,
      attributes: { options: connectionOptions(pluginCfg) },
      sublabel:
        "Welche in der Plugin-Konfiguration angelegte Verbindung (Server + Freigabe) diese View nutzt. " +
        "<code>default</code> = die Standardverbindung aus Schritt 1 der Plugin-Konfiguration.",
    }),
    new Field({
      name: "connection_field",
      label: "Verbindung aus Feld (optional)",
      type: "String",
      attributes: { options: ["", ...(stringFieldOptions || [])] },
      sublabel:
        "Optional. Enthält die Zeile in diesem Feld eine Verbindungs-Kennung (z. B. <code>archiv</code>), " +
        "wird diese statt der oben gewählten Verbindung benutzt. Leer = immer die oben gewählte Verbindung.",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Rendering-Helfer
// ---------------------------------------------------------------------------

/** CSRF-Token des aktuellen Requests (leer, wenn nicht verfügbar). */
function extractCsrf(extra) {
  const req = extra && extra.req;
  if (req && typeof req.csrfToken === "function") {
    try {
      return req.csrfToken();
    } catch (_) {
      return "";
    }
  }
  return "";
}

/** Locale + i18n-Katalog des Requests (Fallback "en"). */
function resolveLocaleAndCatalog(extra) {
  const req = extra && extra.req;
  const locale = resolveLocaleFromReq(req);
  return { locale, catalog: catalogFor(locale) };
}

/**
 * JSON für die Einbettung in ein <script>: `<` wird escaped, damit ein
 * `</script>` im Inhalt den HTML-Parser nicht vorzeitig beendet.
 */
function serialiseForScript(value) {
  return JSON.stringify(value === undefined ? null : value).replace(/</g, "\\u003c");
}

/**
 * Drei-Stufen-Bootstrap für die Client-Skripte:
 *   1. samba-i18n-runtime.js  (window.SambaI18nRuntime)
 *   2. samba-common.js        (window.SambaCommon) + Katalog setzen
 *   3. view-spezifisches Skript, danach `mountExpression` ausführen
 * Bereits geladene Skripte werden übersprungen.
 *
 * @param {object} p
 * @param {string} p.pluginVersion
 * @param {object} p.catalog
 * @param {string} p.viewScript      Dateiname unter public/, z. B. "samba-tree.js"
 * @param {string} p.readyGlobal     globale Mount-Funktion, z. B. "saltcornSambaMount"
 * @param {string} p.mountExpression JS-Ausdruck, der die View mountet
 */
function bootstrapScript(p) {
  const base = `/plugins/public/saltcorn-samba@${p.pluginVersion}`;
  return `(function(){
  var CATALOG=${serialiseForScript(p.catalog || {})};
  var BASE=${serialiseForScript(base)};
  function loadScript(src, cb){ var s=document.createElement('script'); s.src=src; s.onload=cb; document.head.appendChild(s); }
  function applyCatalog(){ if(window.SambaCommon && window.SambaCommon.setCatalog) window.SambaCommon.setCatalog(CATALOG); }
  function mount(){ ${p.mountExpression}; }
  function ensureView(){ if(window.${p.readyGlobal}){ mount(); return; } loadScript(BASE+'/${p.viewScript}', mount); }
  function ensureCommon(){
    if(window.SambaCommon){ applyCatalog(); ensureView(); return; }
    loadScript(BASE+'/samba-common.js', function(){ applyCatalog(); ensureView(); });
  }
  if(window.SambaI18nRuntime){ ensureCommon(); return; }
  loadScript(BASE+'/samba-i18n-runtime.js', ensureCommon);
})();`;
}

// ---------------------------------------------------------------------------
// View-Bindung (ab v0.6.0)
// ---------------------------------------------------------------------------

/**
 * Lädt die Zeile für eine View aus dem URL-State – mit Saltcorns
 * Zeilenrechten (Eigentümer-Feld, Tabellen-Leserolle, RLS) für den
 * aktuellen Benutzer. Bis v0.5.0 wurde `table.getRow(state)` ohne
 * Rechteprüfung und mit dem kompletten State aufgerufen; ein State ohne
 * passende Spalten lieferte dabei sogar die ERSTE Zeile der Tabelle.
 *
 * @param {object} table  Saltcorn-Table (bereits geladen)
 * @param {object} state  URL-State der View
 * @param {object} req    Request (für forUser / forPublic)
 * @returns {Promise<object|null>}
 */
async function loadRowForView(table, state, req) {
  if (!table || !state || typeof state !== "object") return null;
  let fields = table.fields;
  if (!Array.isArray(fields) && typeof table.getFields === "function") {
    fields = await table.getFields();
  }
  const names = new Set((fields || []).map((f) => f.name));
  if (table.pk_name) names.add(table.pk_name);
  const where = {};
  for (const [k, v] of Object.entries(state)) {
    if (names.has(k) && v !== undefined && v !== null && v !== "") where[k] = v;
  }
  if (!Object.keys(where).length) return null;
  const user = req && req.user && req.user.id ? req.user : null;
  try {
    return (await table.getRow(where, { forUser: user || undefined, forPublic: !user })) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Im Modus „from_field“ MUSS die Zeile einen Pfadwert liefern. Bis v0.5.0
 * fiel die View sonst still auf `view_base_path` zurück – eine View für
 * „Ordner von Kunde X“ zeigte ohne Datensatz den Ordner ALLER Kunden.
 * Wirft eine verständliche Meldung (fail closed).
 */
function assertRowPath(configuration, row) {
  const cfg = configuration || {};
  if (cfg.mode !== "from_field" || !cfg.path_field) return;
  const v = row ? row[cfg.path_field] : undefined;
  if (v === undefined || v === null || String(v).trim() === "") {
    const e = new Error(
      row
        ? "Der Datensatz hat im Feld „" + cfg.path_field + "“ keinen Ordner hinterlegt."
        : "Kein Datensatz ausgewählt oder kein Leserecht – der Ordner kann nicht bestimmt werden."
    );
    e.status = 404;
    throw e;
  }
}

/**
 * Stellt das View-Token für eine gerenderte View-Instanz aus.
 * @param {object} p  { req, viewname, connection, startPath, write, hidden, smbLink }
 */
function viewTokenFor(p) {
  return issueForView({
    pluginCfg: getPluginConfig(),
    req: p.req,
    connection: p.connection,
    root: p.startPath || "",
    write: !!p.write,
    hidden: !!p.hidden,
    smbLink: !!p.smbLink,
    viewname: p.viewname,
  });
}

module.exports = {
  loadRowForView,
  assertRowPath,
  viewTokenFor,
  computeStartPath,
  resolveViewConnection,
  connectionConfigFields,
  extractCsrf,
  resolveLocaleAndCatalog,
  serialiseForScript,
  bootstrapScript,
};
