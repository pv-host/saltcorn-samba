/**
 * SMB client wrapper – provides a small, connection-pooled interface
 * around @marsaud/smb2 with security-conscious path handling.
 *
 * All paths that come from the browser MUST be validated with
 * `sanitizeRelativePath` before being combined with the base_path.
 */

const path = require("path");
const SMB2 = require("@marsaud/smb2");

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Validate a single file/directory name component (no path separators!).
 * Rejects empty, dot-only, path separators, control chars, and reserved
 * Windows device names. Returns the trimmed name on success, throws on
 * invalid input.
 */
function sanitizeFilename(name) {
  if (name === undefined || name === null) throw new Error("Filename required");
  if (typeof name !== "string") throw new Error("Filename must be a string");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Filename must not be empty");
  // reject leading/trailing whitespace on non-empty names (Windows problem)
  if (name !== trimmed)
    throw new Error("Filename must not start or end with whitespace");
  if (trimmed.length > 255) throw new Error("Filename too long");
  if (trimmed === "." || trimmed === "..")
    throw new Error("Filename must not be '.' or '..'");
  if (/[\\/]/.test(trimmed)) throw new Error("Filename must not contain slashes");
  if (/[\x00-\x1f]/.test(trimmed)) throw new Error("Filename must not contain control characters");
  // Reject characters SMB / Windows disallow in filenames
  if (/[<>:"|?*]/.test(trimmed))
    throw new Error('Filename must not contain any of: < > : " | ? *');
  if (trimmed.endsWith(".") || trimmed.endsWith(" "))
    throw new Error("Filename must not end with a dot or space");
  // Windows reserved device names (case-insensitive, with or without extension)
  const base = trimmed.split(".")[0].toUpperCase();
  const RESERVED = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  ]);
  if (RESERVED.has(base)) throw new Error("Filename uses a reserved device name");
  return trimmed;
}

/**
 * Reject path traversal, absolute paths, drive letters, NUL bytes, and other
 * suspicious content. Returns a normalised POSIX-style relative path (no
 * leading/trailing separators). Throws on invalid input.
 */
function sanitizeRelativePath(rel) {
  if (rel === undefined || rel === null || rel === "") return "";
  if (typeof rel !== "string") throw new Error("Path must be a string");
  if (rel.length > 4096) throw new Error("Path too long");
  if (rel.includes("\0")) throw new Error("Illegal NUL byte in path");
  // Convert backslashes to forward slashes first (do NOT collapse yet)
  let p = rel.replace(/\\/g, "/");
  // Reject Windows drive letters and UNC paths BEFORE collapsing slashes
  if (/^[a-zA-Z]:/.test(p)) throw new Error("Drive letters not allowed");
  if (p.startsWith("//")) throw new Error("UNC paths not allowed");
  // Now collapse multiple slashes and strip leading slash
  p = p.replace(/\/+/g, "/");
  if (p.startsWith("/")) p = p.slice(1);
  // Reject explicit traversal segments
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  for (const seg of parts) {
    if (seg === "..") throw new Error("Path traversal not allowed");
  }
  return parts.join("/");
}

/** Convert a POSIX-style relative path into the SMB backslash form. */
function toSmbPath(rel) {
  return rel.replace(/\//g, "\\");
}

// ---------------------------------------------------------------------------
// SMB client factory
// ---------------------------------------------------------------------------

/**
 * Build a fresh SMB2 client from the plugin configuration.
 *
 *   config = {
 *     server:   "192.168.1.10",     // host or IP of the samba server
 *     share:    "documents",        // share name (no slashes)
 *     domain:   "WORKGROUP",        // optional
 *     username: "reader",
 *     password: "secret",
 *     base_path:"",                 // optional subdirectory to lock into
 *     port:     445,                // optional
 *   }
 *
 * The returned object exposes: readdir(rel), stat(rel), readFile(rel),
 * createReadStream(rel), disconnect(), plus helpers `resolve(rel)` and
 * `basePath`.
 */
function buildClient(config) {
  if (!config) throw new Error("Samba plugin is not configured");
  const { server, share, domain, username, password, port } = config;
  if (!server) throw new Error("Samba: server missing");
  if (!share) throw new Error("Samba: share missing");
  if (/[\\/]/.test(share)) throw new Error("Samba: share must not contain slashes");

  const shareStr = `\\\\${server}${port ? ":" + port : ""}\\${share}`;
  const smb = new SMB2({
    share: shareStr,
    domain: domain || "WORKGROUP",
    username: username || "guest",
    password: password || "",
    autoCloseTimeout: 10000,
  });

  const basePath = sanitizeRelativePath(config.base_path || "");

  /** Combine base + user-supplied relative into a validated SMB path. */
  function resolve(rel) {
    const safe = sanitizeRelativePath(rel);
    const combined = [basePath, safe].filter(Boolean).join("/");
    return toSmbPath(combined);
  }

  return {
    basePath,
    resolve,
    readdir(rel) {
      return new Promise((res, rej) => {
        smb.readdir(resolve(rel), { stats: true }, (err, files) =>
          err ? rej(err) : res(files)
        );
      });
    },
    stat(rel) {
      return new Promise((res, rej) => {
        // marsaud-smb2 does not export a proper stat; emulate via readdir of parent
        const target = resolve(rel);
        const parent = target.includes("\\")
          ? target.slice(0, target.lastIndexOf("\\"))
          : "";
        const name = target.includes("\\")
          ? target.slice(target.lastIndexOf("\\") + 1)
          : target;
        smb.readdir(parent, { stats: true }, (err, files) => {
          if (err) return rej(err);
          const match = files.find((f) => f.name === name);
          if (!match) return rej(new Error("Not found"));
          res(match);
        });
      });
    },
    readFile(rel) {
      return new Promise((res, rej) => {
        smb.readFile(resolve(rel), (err, data) =>
          err ? rej(err) : res(data)
        );
      });
    },
    writeFile(rel, data) {
      return new Promise((res, rej) => {
        smb.writeFile(resolve(rel), data, (err) =>
          err ? rej(err) : res()
        );
      });
    },
    exists(rel) {
      return new Promise((res) => {
        smb.exists(resolve(rel), (err, ok) => res(err ? false : !!ok));
      });
    },
    unlink(rel) {
      return new Promise((res, rej) => {
        smb.unlink(resolve(rel), (err) => (err ? rej(err) : res()));
      });
    },
    rmdir(rel) {
      return new Promise((res, rej) => {
        smb.rmdir(resolve(rel), (err) => (err ? rej(err) : res()));
      });
    },
    mkdir(rel) {
      return new Promise((res, rej) => {
        smb.mkdir(resolve(rel), (err) => (err ? rej(err) : res()));
      });
    },
    rename(oldRel, newRel) {
      return new Promise((res, rej) => {
        smb.rename(resolve(oldRel), resolve(newRel), (err) =>
          err ? rej(err) : res()
        );
      });
    },
    createReadStream(rel) {
      return new Promise((res, rej) => {
        smb.createReadStream(resolve(rel), (err, stream) =>
          err ? rej(err) : res(stream)
        );
      });
    },
    disconnect() {
      try {
        smb.disconnect();
      } catch (_) {
        // ignore
      }
    },
  };
}

/**
 * Execute a callback with a fresh SMB client and always disconnect afterwards.
 * Prefer this helper over building a long-lived client because SMB sessions
 * can time out and marsaud-smb2 does not handle reconnects well.
 */
async function withClient(config, fn) {
  const client = buildClient(config);
  try {
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Build a browser-openable smb:// URL for external file managers. */
function toSmbUrl(config, rel) {
  const safe = sanitizeRelativePath(rel);
  const basePath = sanitizeRelativePath(config.base_path || "");
  const parts = [basePath, safe].filter(Boolean).join("/");
  const encoded = parts.split("/").map(encodeURIComponent).join("/");
  return `smb://${config.server}/${encodeURIComponent(config.share)}${
    encoded ? "/" + encoded : ""
  }`;
}

/** Guess a MIME type from a filename – kept tiny and dependency-free. */
function mimeFromName(name) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  const map = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    json: "application/json",
    xml: "application/xml",
    html: "text/html; charset=utf-8",
    zip: "application/zip",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] || "application/octet-stream";
}

module.exports = {
  buildClient,
  withClient,
  sanitizeRelativePath,
  sanitizeFilename,
  toSmbPath,
  toSmbUrl,
  mimeFromName,
};
