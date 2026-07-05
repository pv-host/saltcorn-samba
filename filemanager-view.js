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
 */

const { div, span, script } = require("@saltcorn/markup/tags");
const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");

const { sanitizeRelativePath } = require("./smb-client");

// ---------------------------------------------------------------------------
// Configuration workflow
// ---------------------------------------------------------------------------

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "File manager options",
        form: async (context) => {
          const table = context.table_id
            ? await Table.findOne({ id: context.table_id })
            : null;
          const fields = table ? await table.getFields() : [];
          const stringFieldOptions = fields
            .filter(
              (f) =>
                f.type &&
                (f.type.name === "String" ||
                  f.type === "String" ||
                  f.type.name === "Text")
            )
            .map((f) => f.name);
          return new Form({
            fields: [
              new Field({
                name: "mode",
                label: "Root directory mode",
                type: "String",
                required: true,
                attributes: {
                  options: ["static", "from_field"],
                },
                sublabel:
                  "static = always the plugin base_path. from_field = append a row field value to base_path (only when the view is embedded in a Show view).",
                default: "static",
              }),
              new Field({
                name: "path_field",
                label: "Row field with sub-path",
                type: "String",
                attributes: { options: stringFieldOptions },
                showIf: { mode: "from_field" },
              }),
              new Field({
                name: "extra_subpath",
                label: "Extra sub-path (appended)",
                type: "String",
                sublabel:
                  "Optional. Static suffix appended after the field value. Example: 'invoices'",
              }),
              new Field({
                name: "show_hidden",
                label: "Show hidden files",
                type: "Bool",
              }),
              new Field({
                name: "allow_navigate_up",
                label: "Allow navigating up (until the root)",
                type: "Bool",
                default: true,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get_state_fields() {
  return [];
}

function computeStartPath(configuration, row) {
  const parts = [];
  if (configuration.mode === "from_field" && configuration.path_field && row) {
    const v = row[configuration.path_field];
    if (v) parts.push(String(v));
  }
  if (configuration.extra_subpath) parts.push(String(configuration.extra_subpath));
  return sanitizeRelativePath(parts.join("/"));
}

// ---------------------------------------------------------------------------
// Shell renderer
// ---------------------------------------------------------------------------

function renderShell(startPath, configuration, pluginVersion) {
  const id = "samba-fm-" + Math.random().toString(36).slice(2, 10);
  const opts = {
    startPath,
    showHidden: !!configuration.show_hidden,
    allowNavigateUp: configuration.allow_navigate_up !== false,
    pdfInline: configuration.pdf_inline !== false,
    exposeSmbLink: configuration.expose_smb_link !== false,
    pageSize: Number(configuration.page_size) || 0,
    title: configuration.title || "Samba files",
  };

  return (
    div(
      { class: "samba-fm card" },
      div(
        { class: "card-header d-flex align-items-center" },
        span({ class: "samba-fm-title fw-bold" }, opts.title),
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
      `(function(){
         function boot(){window.saltcornSambaMountFM && window.saltcornSambaMountFM(${JSON.stringify(
           id
         )}, ${JSON.stringify(opts)});}
         if(window.saltcornSambaMountFM){boot();return;}
         var s=document.createElement('script');
         s.src='/plugins/public/saltcorn-samba@${pluginVersion}/samba-filemanager.js';
         s.onload=boot;
         document.head.appendChild(s);
       })();`
    )
  );
}

// ---------------------------------------------------------------------------
// View functions
// ---------------------------------------------------------------------------

async function run(table_id, viewname, configuration, state, extra) {
  const pluginVersion = configuration.__pluginVersion || "0.2.0";
  let row = extra && extra.row;
  if (!row && configuration.mode === "from_field" && table_id) {
    const table = await Table.findOne({ id: table_id });
    if (table && state && Object.keys(state).length) {
      try {
        row = await table.getRow(state);
      } catch (_) {
        row = null;
      }
    }
  }
  let startPath = "";
  try {
    startPath = computeStartPath(configuration, row || {});
  } catch (e) {
    return div({ class: "alert alert-danger" }, "Samba file manager: " + e.message);
  }
  return renderShell(startPath, configuration, pluginVersion);
}

async function runMany(table_id, viewname, configuration, state, extra) {
  const pluginVersion = configuration.__pluginVersion || "0.2.0";
  const rows = (extra && extra.rows) || [];
  return rows.map((row) => {
    let startPath = "";
    try {
      startPath = computeStartPath(configuration, row);
    } catch (_) {
      startPath = "";
    }
    return {
      html: renderShell(startPath, configuration, pluginVersion),
      row,
    };
  });
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
