/**
 * View template: `SambaTree`
 *
 * Renders a lazy-loading directory tree of a Samba share. Each directory can
 * be expanded via AJAX; clicking a file opens the PDF viewer route (for PDFs
 * and images) or triggers an "open in external app" link (smb://) for
 * everything else.
 *
 * The view has two operating modes:
 *   - "static"          – always show the same base_path from the config
 *   - "from_field"      – append the value of a row field to base_path
 *                         (only meaningful when embedded in a Show view)
 *
 * Ab v0.5.0 wählt jede View eine Samba-Verbindung aus der Plugin-
 * Konfiguration – statisch oder pro Zeile aus einem Tabellenfeld.
 */

"use strict";

const { div, span, script } = require("@saltcorn/markup/tags");
const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");

const { tFor, resolveLocaleFromReq } = require("./i18n");
const { getPluginConfig } = require("./plugin-config");
const { resolveConnection } = require("./connections");
const {
  computeStartPath,
  resolveViewConnection,
  connectionConfigFields,
  resolveLocaleAndCatalog,
  bootstrapScript,
  loadRowForView,
  assertRowPath,
  viewTokenFor,
} = require("./view-common");

// ---------------------------------------------------------------------------
// Configuration workflow
// ---------------------------------------------------------------------------

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "Tree options",
        form: async (context) => {
          const table = context.table_id ? await Table.findOne({ id: context.table_id }) : null;
          const fields = table ? await table.getFields() : [];
          const stringFieldOptions = fields
            .filter(
              (f) =>
                f.type &&
                (f.type.name === "String" || f.type === "String" || f.type.name === "Text")
            )
            .map((f) => f.name);
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
                name: "pdf_inline",
                label: "Open PDFs inline",
                type: "Bool",
                default: true,
              }),
              new Field({
                name: "expose_smb_link",
                label: "Show 'Open in file manager' link (smb://)",
                type: "Bool",
                default: true,
                sublabel:
                  "Adds a button that opens the file/folder in Nemo, Nautilus, Dolphin, Explorer etc.",
              }),
            ],
          });
        },
      },
    ],
  });

async function get_state_fields() {
  // Die Tree-View braucht keine eigenen State-Felder – sie arbeitet immer
  // auf der aktuellen Zeile (eingebettet) bzw. dem statischen Pfad.
  return [];
}

// ---------------------------------------------------------------------------
// Render – client-side JS is served from /public/samba-tree.js
// ---------------------------------------------------------------------------

function renderShell(p) {
  const { viewname, startPath, connection, configuration, locale, catalog, viewToken } = p;
  const treeId = `samba-tree-${Math.random().toString(36).slice(2, 10)}`;
  const pluginVersion = configuration.__pluginVersion || "0.6.0";
  const pathLabel = (catalog && catalog["ui.path"]) || "Path:";
  // Nur Kennung + Anzeigename der Verbindung gehen an den Browser.
  const opts = {
    viewname,
    startPath,
    connection: connection.name,
    pdfInline: !!configuration.pdf_inline,
    exposeSmbLink: configuration.expose_smb_link !== false,
    showHidden: !!configuration.show_hidden,
    viewToken, // bindet Requests an diese View (Tree = immer nur lesen)
    locale: locale || "en",
  };
  return (
    div(
      { class: "samba-tree-container card p-2", "data-samba-connection": connection.name },
      div(
        { class: "samba-tree-toolbar d-flex align-items-center mb-2" },
        span({ class: "text-muted small me-2" }, pathLabel),
        span({ class: "samba-tree-breadcrumb small fw-bold" }, startPath || "/"),
        connection.name !== "default"
          ? span({ class: "badge bg-secondary ms-2 samba-tree-conn" }, connection.label)
          : ""
      ),
      div({ id: treeId, class: "samba-tree", "data-opts": JSON.stringify(opts) }),
      div({ id: treeId + "-viewer", class: "samba-viewer mt-3" })
    ) +
    script(
      bootstrapScript({
        pluginVersion,
        catalog,
        viewScript: "samba-tree.js",
        readyGlobal: "saltcornSambaMount",
        mountExpression: `window.saltcornSambaMount(${JSON.stringify(treeId)})`,
      })
    )
  );
}

function renderFor(viewname, configuration, row, extra) {
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
      write: false,
      hidden: !!configuration.show_hidden,
      smbLink: configuration.expose_smb_link !== false,
    });
  } catch (e) {
    const _t = tFor(resolveLocaleFromReq(extra && extra.req));
    return div({ class: "alert alert-danger" }, _t("tree.samba_prefix") + e.message);
  }
  const { locale, catalog } = resolveLocaleAndCatalog(extra);
  return renderShell({ viewname, startPath, connection, configuration, locale, catalog, viewToken });
}

// ---------------------------------------------------------------------------
// View: run (single row) and runMany
// ---------------------------------------------------------------------------

async function run(table_id, viewname, configuration, state, extra) {
  // "state" enthält beim direkten Aufruf meist den Primärschlüssel der Zeile;
  // eingebettet in eine Show-View ist `extra.row` gesetzt.
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
  name: "SambaTree",
  display_state_form: false,
  get_state_fields,
  configuration_workflow,
  run,
  runMany,
  description:
    "Browse a Samba/CIFS share as a lazy-loading directory tree. Files open inline (PDF) or in the OS file manager.",
};
