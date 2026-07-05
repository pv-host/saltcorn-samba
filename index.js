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
                sublabel: "Hostname or IP of the Samba server (no smb:// prefix)",
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
              new Field({ name: "domain", label: "Domain / Workgroup", type: "String", default: "WORKGROUP" }),
              new Field({ name: "username", label: "Username", type: "String" }),
              new Field({ name: "password", label: "Password", type: "String", input_type: "password" }),
              new Field({
                name: "base_path",
                label: "Base path",
                sublabel: "Optional. All access is restricted to this sub-directory of the share.",
                type: "String",
              }),
              new Field({ name: "port", label: "Port", type: "Integer", default: 445 }),
            ],
          }),
      },
      {
        name: "Access & permissions",
        form: () =>
          new Form({
            fields: [
              new Field({
                name: "min_role_read",
                label: "Minimum role to read files",
                sublabel: "Saltcorn role level. 1=admin, 40=staff, 80=user, 100=public. Default: 80.",
                type: "Integer",
                default: 80,
              }),
              new Field({
                name: "min_role_write",
                label: "Minimum role to upload / delete / rename",
                sublabel:
                  "Set to 100 to disable all write actions completely. Default: 40 (staff and admins).",
                type: "Integer",
                default: 40,
              }),
              new Field({
                name: "allow_upload",
                label: "Allow file upload",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "allow_delete",
                label: "Allow delete",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "allow_rename",
                label: "Allow rename / move",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "allow_mkdir",
                label: "Allow creating new directories",
                type: "Bool",
                default: false,
              }),
              new Field({
                name: "max_upload_mb",
                label: "Max upload size per file (MiB)",
                type: "Integer",
                default: 50,
              }),
              new Field({
                name: "denied_extensions",
                label: "Blocked file extensions (comma-separated, no dots)",
                sublabel:
                  "Default: exe,bat,cmd,com,msi,scr,vbs,js,jse,wsf,wsh,ps1,ps1xml,psm1,sh,bash,zsh. Leave empty for the default set.",
                type: "String",
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
  return (req && req.user && req.user.role_id) || 100;
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
 * Validate that the request carries a CSRF token matching the session.
 * Saltcorn injects `req.csrfToken()` when the CSRF middleware is active;
 * we accept either the `_csrf` body field or the `x-csrf-token` header.
 */
function checkCsrf(req, res) {
  if (typeof req.csrfToken !== "function") return true; // CSRF disabled globally
  const expected = req.csrfToken();
  const provided =
    (req.body && req.body._csrf) ||
    req.headers["x-csrf-token"] ||
    req.headers["csrf-token"] ||
    req.query._csrf;
  if (!provided || provided !== expected) {
    jsonError(res, 403, "Invalid CSRF token");
    return false;
  }
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
    callback: async ({ req, res }) => {
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
    callback: async ({ req, res }) => {
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
    callback: async ({ req, res }) => {
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

  // ---- Write routes (v0.3.0) --------------------------------------------

  {
    url: "/sambaupload",
    method: "post",
    callback: async ({ req, res }) => {
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
    callback: async ({ req, res }) => {
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
    callback: async ({ req, res }) => {
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
    url: "/sambamkdir",
    method: "post",
    callback: async ({ req, res }) => {
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

module.exports = {
  sc_plugin_api_version: 1,
  plugin_name: PLUGIN_NAME,
  configuration_workflow,
  viewtemplates: [wrapView(fileManagerView), wrapView(treeView)],
  routes,
  headers: [
    { css: `/plugins/public/${PLUGIN_NAME}/samba.css` },
  ],
  dependencies: [],
};

// Note: the `samba_pdf` fieldview shipped in v0.1–0.3.1 has been removed from
// the top-level manifest because Saltcorn's plugin loader requires field
// views to be attached to a type, not registered globally. The inline PDF /
// image viewer is still available through the SambaFileManager view (click a
// row) and via the `GET /sambafile?path=...&disposition=inline` route.
// A properly-typed reintroduction of `samba_pdf` will follow together with
// the DB-linkage feature in a later release.
