/**
 * saltcorn-samba
 * ----------------------------------------------------------------------------
 * Saltcorn plugin providing browser-based access to a Samba/CIFS share.
 *
 * Provides:
 *   1. `SambaFileManager` view template
 *          Saltcorn-style file browser (like Settings → Files). Table with
 *          icon / name / media type / size / modified date / actions,
 *          breadcrumbs, up-navigation and inline PDF/image viewer.
 *   2. `SambaTree` view template
 *          Lazy-loading directory tree.
 *   3. `samba_pdf` fieldview
 *          For String fields containing a relative path – renders the file
 *          inline (PDF/image) or as buttons.
 *   4. Routes
 *          GET /sambadir      → list a directory as JSON
 *          GET /sambafile     → stream a file (inline or attachment)
 *          GET /sambalink     → HTML page with an smb:// link (opens in
 *                                Nemo/Nautilus/Dolphin/Explorer)
 *
 * All routes require the caller to have a role at or below the configured
 * `min_role_read`. Every path from the browser is validated against path
 * traversal, drive letters, UNC paths and NUL bytes before being combined
 * with the plugin's `base_path`.
 * ----------------------------------------------------------------------------
 */

"use strict";

const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const Field = require("@saltcorn/data/models/field");
const { getState } = require("@saltcorn/data/db/state");

const pkg = require("./package.json");
const {
  withClient,
  toSmbUrl,
  mimeFromName,
  sanitizeRelativePath,
} = require("./smb-client");
const treeView = require("./tree-view");
const fileManagerView = require("./filemanager-view");
const { samba_pdf } = require("./pdf-view");

const PLUGIN_VERSION = pkg.version;
// Saltcorn serves plugin public files at /plugins/public/<plugin_name>@<version>/
const PLUGIN_NAME = "saltcorn-samba@" + PLUGIN_VERSION;

// ---------------------------------------------------------------------------
// Plugin-level configuration
// ---------------------------------------------------------------------------

const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "Samba server",
        form: () =>
          new Form({
            fields: [
              new Field({
                name: "server",
                label: "Server",
                sublabel:
                  "Hostname or IP of the Samba server (no smb:// prefix)",
                type: "String",
                required: true,
              }),
              new Field({
                name: "share",
                label: "Share name",
                sublabel: "The share to connect to (without slashes)",
                type: "String",
                required: true,
              }),
              new Field({
                name: "domain",
                label: "Domain / Workgroup",
                type: "String",
                default: "WORKGROUP",
              }),
              new Field({
                name: "username",
                label: "Username",
                type: "String",
              }),
              new Field({
                name: "password",
                label: "Password",
                type: "String",
                input_type: "password",
              }),
              new Field({
                name: "base_path",
                label: "Base path",
                sublabel:
                  "Optional. All access is restricted to this sub-directory of the share.",
                type: "String",
              }),
              new Field({
                name: "port",
                label: "Port",
                type: "Integer",
                default: 445,
              }),
              new Field({
                name: "min_role_read",
                label: "Minimum role to read files",
                sublabel:
                  "Saltcorn role level. 1=admin, 40=staff, 80=user, 100=public. Default: 80.",
                type: "Integer",
                default: 80,
              }),
              new Field({
                name: "public_smb_host",
                label: "SMB host visible to clients",
                sublabel:
                  "Optional. Host used in generated smb:// links. Defaults to the server field. Useful when Saltcorn runs in Docker but clients should see the LAN name.",
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

/** Read plugin configuration from Saltcorn state (supports versioned key). */
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

function isAllowed(req, cfg) {
  const min = Number(cfg.min_role_read || 80);
  const role = (req && req.user && req.user.role_id) || 100;
  return role <= min;
}

function jsonError(res, status, msg) {
  res.status(status).json({ error: msg });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes = [
  // --- Directory listing ---------------------------------------------------
  {
    url: "/sambadir",
    method: "get",
    callback: async ({ req, res }) => {
      const cfg = getConfig();
      if (!cfg.server) return jsonError(res, 500, "Samba plugin not configured");
      if (!isAllowed(req, cfg)) return jsonError(res, 403, "Forbidden");
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
        res.json({ path: rel, items });
      } catch (e) {
        jsonError(res, 500, "Samba: " + (e.message || String(e)));
      }
    },
  },
  // --- File download / inline view ----------------------------------------
  {
    url: "/sambafile",
    method: "get",
    callback: async ({ req, res }) => {
      const cfg = getConfig();
      if (!cfg.server) return res.status(500).send("Samba plugin not configured");
      if (!isAllowed(req, cfg)) return res.status(403).send("Forbidden");
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
  // --- smb:// redirect page -----------------------------------------------
  {
    url: "/sambalink",
    method: "get",
    callback: async ({ req, res }) => {
      const cfg = getConfig();
      if (!cfg.server) return res.status(500).send("Samba plugin not configured");
      if (!isAllowed(req, cfg)) return res.status(403).send("Forbidden");
      let rel = "";
      try {
        rel = sanitizeRelativePath(req.query.path || "");
      } catch (e) {
        return res.status(400).send(e.message);
      }
      const effectiveCfg = {
        ...cfg,
        server: cfg.public_smb_host || cfg.server,
      };
      const url = toSmbUrl(effectiveCfg, rel);
      const escRel = String(rel || "/").replace(/[<>&"']/g, (c) =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])
      );
      const escUrl = url.replace(/[<>&"']/g, (c) =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])
      );
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
];

// ---------------------------------------------------------------------------
// Inject plugin version into view templates so their client bootstrap script
// tags reference the correct /plugins/public/... URL.
// ---------------------------------------------------------------------------

function wrapView(v) {
  const orig = v.run;
  const origMany = v.runMany;
  return {
    ...v,
    run: async (table_id, viewname, cfg, state, extra) =>
      orig(table_id, viewname, { ...cfg, __pluginVersion: PLUGIN_VERSION }, state, extra),
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
// Plugin manifest
// ---------------------------------------------------------------------------

module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: PLUGIN_NAME,
  configuration_workflow,
  viewtemplates: [wrapView(fileManagerView), wrapView(treeView)],
  fieldviews: {
    samba_pdf,
  },
  routes,
  headers: [
    { css: `/plugins/public/${PLUGIN_NAME}/samba.css` },
  ],
  dependencies: [],
};
