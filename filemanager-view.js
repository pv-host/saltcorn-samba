/**
 * View template: `SambaFileManager`
 *
 * Renders a Saltcorn-style file browser (like Settings → Files) against a
 * Samba/CIFS share. The UI shows a table with columns: icon, name, media
 * type, size, modified, actions. Directories are navigable via click, and
 * the current location is shown as a breadcrumb path.
 *
 * All directory data is fetched lazily from `/sambadir` (defined in the
 * plugin's routes) so the view itself just renders a shell that boots the
 * client-side script.
 *
 * Ab v0.5.0 wählt jede View eine Samba-Verbindung (Server + Freigabe) aus der
 * Plugin-Konfiguration – statisch oder pro Zeile aus einem Tabellenfeld.
 */

"use strict";

const { div, span, script } = require("@saltcorn/markup/tags");
const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");

const { getPluginConfig } = require("./plugin-config");
const { resolveConnection } = require("./connections");
const {
  computeStartPath,
  resolveViewConnection,
  connectionConfigFields,
  extractCsrf,
  resolveLocaleAndCatalog,
  bootstrapScript,
  loadRowForView,
  assertRowPath,
  viewTokenFor,
} = require("./view-common");

// ---------------------------------------------------------------------------
// Configuration workflow
// ---------------------------------------------------------------------------

/** Namen aller Text-Felder der Tabelle (für path_field / connection_field). */
async function stringFieldsOf(table_id) {
  const table = table_id ? await Table.findOne({ id: table_id }) : null;
  const fields = table ? await table.getFields() : [];
  return fields
    .filter(
      (f) =>
        f.type &&
        (f.type.name === "String" || f.type === "String" || f.type.name === "Text")
    )
    .map((f) => f.name);
}

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "File manager options",
        form: async (context) => {
          const stringFieldOptions = await stringFieldsOf(context.table_id);
          return new Form({
            fields: [
              ...connectionConfigFields(Field, getPluginConfig(), stringFieldOptions),
              new Field({
                name: "view_base_path",
                label: "View-Basispfad (relativ zum Basispfad der Verbindung)",
                type: "String",
                sublabel:
                  "Optional. Statischer Pfad relativ zum Basispfad der gew\u00e4hlten Verbindung. " +
                  "Beispiel: Basispfad = 'static', View-Basispfad = 'projekte/2026' \u2192 View listet 'static/projekte/2026'. " +
                  "Keine f\u00fchrenden/abschlie\u00dfenden Slashes n\u00f6tig. Traversal (\u201e..\u201c) wird abgelehnt.",
              }),
              new Field({
                name: "mode",
                label: "Row-Modus",
                type: "String",
                required: true,
                attributes: { options: ["static", "from_field"] },
                sublabel:
                  "static = immer nur der View-Basispfad. from_field = h\u00e4nge einen Feldwert der aktuellen Zeile an " +
                  "(nur sinnvoll, wenn die View in einer Show-View eingebettet ist).",
                default: "static",
              }),
              new Field({
                name: "path_field",
                label: "Feld mit Unterpfad",
                type: "String",
                attributes: { options: stringFieldOptions },
                showIf: { mode: "from_field" },
              }),
              new Field({
                name: "extra_subpath",
                label: "Zus\u00e4tzlicher Suffix (nach dem Feldwert)",
                type: "String",
                sublabel:
                  "Optional. Statischer Suffix, der nach dem Feldwert angeh\u00e4ngt wird. Beispiel: 'invoices'.",
                showIf: { mode: "from_field" },
              }),
              new Field({ name: "show_hidden", label: "Show hidden files", type: "Bool" }),
              new Field({
                name: "allow_navigate_up",
                label: "Allow navigating up (until the root)",
                type: "Bool",
                default: true,
              }),
              new Field({
                name: "view_read_only",
                label: "Nur lesen (diese View)",
                sublabel:
                  "Blendet Upload, Löschen, Umbenennen und Ordner anlegen aus und sperrt sie serverseitig " +
                  "für Zugriffe aus dieser View – auch wenn Rolle und Verbindung Schreiben erlauben.",
                type: "Bool",
              }),
              new Field({
                name: "pdf_inline",
                label: "Open PDFs / images inline",
                type: "Bool",
                default: true,
              }),
              new Field({
                name: "expose_smb_link",
                label: "Show 'Open in file manager' button (smb://)",
                type: "Bool",
                default: true,
              }),
              new Field({
                name: "page_size",
                label: "Page size",
                type: "Integer",
                default: 100,
                sublabel:
                  "How many entries to show per page. 0 = show all (be careful with huge directories).",
              }),
              new Field({
                name: "title",
                label: "Panel title",
                type: "String",
                default: "Samba files",
              }),
            ],
          });
        },
      },
    ],
  });

async function get_state_fields() {
  return [];
}

// ---------------------------------------------------------------------------
// Shell renderer
// ---------------------------------------------------------------------------

/**
 * @param {object} p
 * @param {string} p.startPath
 * @param {object} p.connection     aufgelöste Verbindung (nur name/label werden genutzt!)
 * @param {object} p.configuration  View-Konfiguration
 */
function renderShell(p) {
  const { startPath, connection, configuration, pluginVersion, csrfToken, locale, catalog, viewToken } = p;
  const id = "samba-fm-" + Math.random().toString(36).slice(2, 10);
  // Panel-Titel: ohne eigenen Titel greift die übersetzte Standardbezeichnung.
  const defaultTitle = (catalog && catalog["fm.title_default"]) || "Samba files";
  // Achtung: an den Browser gehen nur Kennung und Anzeigename der Verbindung –
  // niemals Server, Benutzer oder Passwort.
  const opts = {
    startPath,
    connection: connection.name,
    connectionLabel: connection.label,
    showHidden: !!configuration.show_hidden,
    allowNavigateUp: configuration.allow_navigate_up !== false,
    pdfInline: configuration.pdf_inline !== false,
    exposeSmbLink: configuration.expose_smb_link !== false,
    pageSize: Number(configuration.page_size) || 0,
    title: configuration.title || defaultTitle,
    csrfToken: csrfToken || "",
    // Signiertes View-Token: bindet alle Requests an Verbindung,
    // Startordner und Rechte DIESER View-Instanz (siehe view-token.js).
    viewToken,
    locale: locale || "en",
  };

  return (
    div(
      { class: "samba-fm card", "data-samba-connection": connection.name },
      div(
        { class: "card-header d-flex align-items-center" },
        span({ class: "samba-fm-title fw-bold" }, opts.title),
        connection.name !== "default"
          ? span({ class: "badge bg-secondary ms-2 samba-fm-conn" }, connection.label)
          : "",
        span({ class: "samba-fm-spacer flex-grow-1" }),
        span({ id: id + "-count", class: "text-muted small" })
      ),
      div(
        { class: "card-body p-0" },
        div({ id: id + "-toolbar", class: "samba-fm-toolbar p-2 border-bottom" }),
        div({ id: id + "-list", class: "samba-fm-list" }),
        div({ id: id + "-viewer", class: "samba-fm-viewer" })
      )
    ) +
    script(
      bootstrapScript({
        pluginVersion,
        catalog,
        viewScript: "samba-filemanager.js",
        readyGlobal: "saltcornSambaMountFM",
        mountExpression:
          `window.saltcornSambaMountFM(${JSON.stringify(id)}, ${JSON.stringify(opts).replace(/</g, "\\u003c")})`,
      })
    )
  );
}

/** Fehlerbox, wenn Pfad oder Verbindung der View nicht auflösbar sind. */
function renderError(message) {
  return div({ class: "alert alert-danger" }, "Samba file manager: " + message);
}

/** Rendert eine View-Instanz für genau eine Zeile (oder ohne Zeile). */
function renderFor(viewname, configuration, row, extra) {
  const pluginVersion = configuration.__pluginVersion || "0.7.0";
  let connection;
  let startPath;
  let viewToken;
  try {
    assertRowPath(configuration, row);
    connection = resolveConnection(getPluginConfig(), resolveViewConnection(configuration, row));
    startPath = computeStartPath(configuration, row || {});
    viewToken = viewTokenFor({
      req: extra && extra.req,
      viewname,
      connection: connection.name,
      startPath,
      write: !configuration.view_read_only,
      hidden: true, // der File-Manager hat einen eigenen Schalter „versteckte Dateien“
      smbLink: configuration.expose_smb_link !== false,
    });
  } catch (e) {
    return renderError(e.message);
  }
  const { locale, catalog } = resolveLocaleAndCatalog(extra);
  return renderShell({
    startPath,
    connection,
    configuration,
    pluginVersion,
    csrfToken: extractCsrf(extra),
    locale,
    catalog,
    viewToken,
  });
}

// ---------------------------------------------------------------------------
// View functions
// ---------------------------------------------------------------------------

async function run(table_id, viewname, configuration, state, extra) {
  let row = extra && extra.row;
  if (!row && (configuration.mode === "from_field" || configuration.connection_field) && table_id) {
    const table = await Table.findOne({ id: table_id });
    row = await loadRowForView(table, state, extra && extra.req);
  }
  return renderFor(viewname, configuration, row, extra);
}

async function runMany(table_id, viewname, configuration, state, extra) {
  const rows = (extra && extra.rows) || [];
  return rows.map((row) => ({ html: renderFor(viewname, configuration, row, extra), row }));
}

module.exports = {
  name: "SambaFileManager",
  display_state_form: false,
  configuration_workflow,
  get_state_fields,
  run,
  runMany,
  description:
    "Saltcorn-style file browser for a Samba/CIFS share. Table with icon, name, type, size, modified date, and actions.",
};
