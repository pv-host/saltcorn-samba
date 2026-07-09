/**
 * View template: `samba_tree`
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
 */

const { div, a, i, span, script, button } = require("@saltcorn/markup/tags");
const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");

const { withClient, toSmbUrl, sanitizeRelativePath } = require("./smb-client");
const { catalogFor, resolveLocaleFromReq, tFor } = require("./i18n");

// ---------------------------------------------------------------------------
// Configuration workflow
// ---------------------------------------------------------------------------

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "Tree options",
        form: async (context) => {
          const table = await Table.findOne({ id: context.table_id });
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
              new Field({
                name: "view_base_path",
                label: "View-Basispfad (relativ zum Plugin-Basispfad)",
                type: "String",
                sublabel:
                  "Optional. Statischer Pfad relativ zum Plugin-Basispfad, der f\u00fcr diese View gilt. " +
                  "Beispiel: Plugin-Basispfad = 'static', View-Basispfad = 'projekte/2026' \u2192 View listet 'static/projekte/2026'. " +
                  "Keine f\u00fchrenden/abschlie\u00dfenden Slashes n\u00f6tig. Traversal (\u201e..\u201c) wird abgelehnt.",
              }),
              new Field({
                name: "mode",
                label: "Row-Modus",
                type: "String",
                required: true,
                attributes: {
                  options: ["static", "from_field"],
                },
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
              new Field({
                name: "show_hidden",
                label: "Show hidden files",
                type: "Bool",
              }),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get_state_fields(table_id, viewname, { mode, path_field }) {
  if (mode === "from_field" && !path_field) return [];
  // The tree view can be embedded in a Show view and does not require any
  // state fields on its own – we always operate on the current row.
  return [];
}

/**
 * Compose the start path (relative to the plugin base_path) from three
 * optional parts:
 *   1. `view_base_path`  — static, per-view prefix
 *   2. row field value    — only in "from_field" mode
 *   3. `extra_subpath`   — static suffix, only in "from_field" mode
 *
 * Empty parts are dropped and slash-trimmed. The final joined path is
 * passed through sanitizeRelativePath so traversal / absolute paths /
 * backslashes are rejected consistently.
 */
function computeStartPath(configuration, row) {
  const parts = [];
  if (configuration.view_base_path) {
    parts.push(String(configuration.view_base_path));
  }
  if (configuration.mode === "from_field" && configuration.path_field && row) {
    const v = row[configuration.path_field];
    if (v) parts.push(String(v));
  }
  if (
    configuration.mode === "from_field" &&
    configuration.extra_subpath
  ) {
    parts.push(String(configuration.extra_subpath));
  }
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  // sanitizeRelativePath throws on traversal – we let the caller handle it.
  return sanitizeRelativePath(joined);
}

// ---------------------------------------------------------------------------
// Render – client-side JS is served from /public/samba-tree.js
// ---------------------------------------------------------------------------

/**
 * Escaped-Serialisierung des i18n-Katalogs, damit ein enthaltenes `</script>`
 * im \u00dcbersetzungstext den HTML-Parser nicht vorzeitig beendet.
 */
function serialiseCatalog(catalog) {
  return JSON.stringify(catalog || {}).replace(/</g, "\\u003c");
}

function renderShell(viewname, startPath, configuration, locale, catalog) {
  const treeId = `samba-tree-${Math.random().toString(36).slice(2, 10)}`;
  const pluginVersion = configuration.__pluginVersion || "0.2.0";
  const pathLabel = (catalog && catalog["ui.path"]) || "Path:";
  const opts = {
    viewname,
    startPath,
    pdfInline: !!configuration.pdf_inline,
    exposeSmbLink: configuration.expose_smb_link !== false,
    showHidden: !!configuration.show_hidden,
    locale: locale || "en",
  };
  const catalogJson = serialiseCatalog(catalog);
  return (
    div(
      { class: "samba-tree-container card p-2" },
      div(
        { class: "samba-tree-toolbar d-flex align-items-center mb-2" },
        span({ class: "text-muted small me-2" }, pathLabel),
        span({ class: "samba-tree-breadcrumb small fw-bold" }, startPath || "/")
      ),
      div({ id: treeId, class: "samba-tree", "data-opts": JSON.stringify(opts) }),
      div({ id: treeId + "-viewer", class: "samba-viewer mt-3" })
    ) +
    script(
      // Erst samba-common.js (i18n + Utilities) nachladen, Katalog setzen,
      // danach die eigentliche samba-tree.js booten.
      `(function(){
         var CATALOG=${catalogJson};
         function applyCatalog(){ if(window.SambaCommon && window.SambaCommon.setCatalog) window.SambaCommon.setCatalog(CATALOG); }
         function mount(){window.saltcornSambaMount && window.saltcornSambaMount(${JSON.stringify(
           treeId
         )});}
         function loadTree(){
           if(window.saltcornSambaMount){ mount(); return; }
           var s=document.createElement('script');
           s.src='/plugins/public/saltcorn-samba@${pluginVersion}/samba-tree.js';
           s.onload=mount;
           document.head.appendChild(s);
         }
         if(window.SambaCommon){ applyCatalog(); loadTree(); return; }
         var c=document.createElement('script');
         c.src='/plugins/public/saltcorn-samba@${pluginVersion}/samba-common.js';
         c.onload=function(){ applyCatalog(); loadTree(); };
         document.head.appendChild(c);
       })();`
    )
  );
}

// ---------------------------------------------------------------------------
// View: run (single row) and runMany
// ---------------------------------------------------------------------------

/**
 * Bestimmt Locale und Katalog aus dem Saltcorn-Request. `resolveLocaleFromReq`
 * f\u00e4llt bei fehlendem `req` auf "en" zur\u00fcck – kein Crash, kein leeres UI.
 */
function resolveLocaleAndCatalog(extra) {
  const req = extra && extra.req;
  const locale = resolveLocaleFromReq(req);
  return { locale, catalog: catalogFor(locale) };
}

async function run(table_id, viewname, configuration, state, extra) {
  // "state" typically contains the primary key of the row when the view is
  // opened directly. If we are embedded in a Show view, `extra.row` is set.
  let row = extra && extra.row;
  if (!row && configuration.mode === "from_field") {
    const table = await Table.findOne({ id: table_id });
    if (table && state && Object.keys(state).length) {
      row = await table.getRow(state);
    }
  }
  let startPath = "";
  try {
    startPath = computeStartPath(configuration, row || {});
  } catch (e) {
    const _t = tFor(resolveLocaleFromReq(extra && extra.req));
    return div({ class: "alert alert-danger" }, _t("tree.samba_prefix") + e.message);
  }
  const { locale, catalog } = resolveLocaleAndCatalog(extra);
  return renderShell(viewname, startPath, configuration, locale, catalog);
}

async function runMany(table_id, viewname, configuration, state, extra) {
  const rows = extra && extra.rows ? extra.rows : [];
  const { locale, catalog } = resolveLocaleAndCatalog(extra);
  return rows.map((row) => ({
    html: renderShell(
      viewname,
      (() => {
        try {
          return computeStartPath(configuration, row);
        } catch {
          return "";
        }
      })(),
      configuration,
      locale,
      catalog
    ),
    row,
  }));
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
