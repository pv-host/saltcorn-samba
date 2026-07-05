/**
 * SMB client wrapper — provides a connection-scoped, `fs`-like interface
 * around the `smb3-client` npm package (SMB 3.1.1 with AES-CMAC signing
 * and optional AES-GCM encryption).
 *
 * Design notes for v0.4.0:
 *
 * 1. Prior versions used `@marsaud/smb2` (SMB 2.0.2 / 2.1 only, tied to the
 *    unmaintained `ntlm` package that requires DES-ECB and dies on Node 17+
 *    with OpenSSL 3, and unable to satisfy `server signing = mandatory` on
 *    modern Samba servers because it lacks AES-CMAC signing).
 *
 *    `smb3-client` speaks SMB 2.1 / 3.0 / 3.0.2 / 3.1.1, signs with either
 *    HMAC-SHA256 or AES-128-CMAC, does SHA-512 pre-auth integrity, has zero
 *    runtime dependencies, and no DES anywhere.
 *
 * 2. `smb3-client` is pure ESM. This plugin is CommonJS. We therefore load
 *    the module via a cached dynamic `import()` inside an async helper.
 *
 * 3. `smb3-client`'s path convention is "<share>/<sub>/<file>" — the share
 *    name is the FIRST segment of every path passed to `readFile`/`stat`/…
 *    We keep the plugin's external contract (callers still pass paths that
 *    are relative to the share root, e.g. "reports/2026/q1.xlsx"), and the
 *    wrapper prepends the share name and optional base_path.
 *
 * 4. All user-supplied path components MUST go through `sanitizeRelativePath`
 *    and `sanitizeFilename` before being handed to this wrapper. Those
 *    sanitizers are unchanged from previous versions (tests still cover them).
 */

const path = require("path");

// ---------------------------------------------------------------------------
// Dynamic ESM import cache for smb3-client
// ---------------------------------------------------------------------------
//
// The `smb3-client` package is pure ESM (`"type": "module"`), so we cannot
// use CommonJS `require()`. Node supports `import()` in CommonJS as a dynamic
// expression, which returns a Promise. We cache the resolved module.
let _smb3Module = null;
async function getSmb3Client() {
  if (_smb3Module) return _smb3Module;
  // Use string concatenation so bundlers do not try to statically resolve
  // this at build time.
  _smb3Module = await import("smb3-client");
  return _smb3Module;
}

// ---------------------------------------------------------------------------
// Path helpers (unchanged from previous versions — covered by unit tests)
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
  if (name !== trimmed)
    throw new Error("Filename must not start or end with whitespace");
  if (trimmed.length > 255) throw new Error("Filename too long");
  if (trimmed === "." || trimmed === "..")
    throw new Error("Filename must not be '.' or '..'");
  if (/[\\/]/.test(trimmed)) throw new Error("Filename must not contain slashes");
  if (/[\x00-\x1f]/.test(trimmed)) throw new Error("Filename must not contain control characters");
  if (/[<>:"|?*]/.test(trimmed))
    throw new Error('Filename must not contain any of: < > : " | ? *');
  if (trimmed.endsWith(".") || trimmed.endsWith(" "))
    throw new Error("Filename must not end with a dot or space");
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
  let p = rel.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(p)) throw new Error("Drive letters not allowed");
  if (p.startsWith("//")) throw new Error("UNC paths not allowed");
  p = p.replace(/\/+/g, "/");
  if (p.startsWith("/")) p = p.slice(1);
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  for (const seg of parts) {
    if (seg === "..") throw new Error("Path traversal not allowed");
  }
  return parts.join("/");
}

/**
 * Convert a POSIX-style relative path into the SMB backslash form.
 * Kept for backwards compatibility — smb3-client itself uses forward
 * slashes, but external callers (URL builders, logging) may still use
 * this helper.
 */
function toSmbPath(rel) {
  return rel.replace(/\//g, "\\");
}

// ---------------------------------------------------------------------------
// Host / port helpers
// ---------------------------------------------------------------------------

/**
 * Split a possibly-composite server field into { host, port }.
 * Tolerant to `host:445` typed into the server field, `[::1]:445` IPv6, and
 * plain hostnames or bare IPs. Never returns a host string that contains a
 * colon-port suffix (that would break DNS lookup).
 */
function parseHostPort(server, explicitPort) {
  let host = String(server || "").trim();
  let port;

  const v6 = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    host = v6[1];
    if (v6[2]) port = Number(v6[2]);
  } else {
    const colonCount = (host.match(/:/g) || []).length;
    if (colonCount === 1) {
      const [h, p] = host.split(":");
      if (h && /^\d+$/.test(p)) {
        host = h;
        port = Number(p);
      }
    }
  }

  return {
    host,
    port: Number(explicitPort) || port || 445,
  };
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** Normalise the security-mode fields to smb3-client's vocabulary. */
function normSecurityMode(v, fallback) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "disabled" || s === "if-offered" || s === "required") return s;
  return fallback;
}

// ---------------------------------------------------------------------------
// SMB client factory
// ---------------------------------------------------------------------------

/**
 * Build and connect a fresh smb3-client `Client` from the plugin
 * configuration. Returns a small wrapper object with `fs`-like methods that
 * accept paths RELATIVE TO THE SHARE ROOT (with `base_path` automatically
 * prepended). Always call `disconnect()` when done — or use `withClient()`.
 *
 *   config = {
 *     server:   "192.168.1.10",        // host or IP
 *     share:    "documents",           // share name (no slashes)
 *     domain:   "WORKGROUP",           // optional
 *     username: "reader",
 *     password: "secret",
 *     base_path:"",                    // optional subdirectory lock
 *     port:     445,                   // optional
 *     signing_mode:    "required",     // "disabled" | "if-offered" | "required"
 *     encryption_mode: "if-offered",   // ditto
 *   }
 */
async function buildClient(config) {
  if (!config) throw new Error("Samba plugin is not configured");
  const { server, share, domain, username, password } = config;
  if (!server) throw new Error("Samba: server missing");
  if (!share) throw new Error("Samba: share missing");
  if (/[\\/]/.test(share))
    throw new Error("Samba: share must not contain slashes");

  const { host, port } = parseHostPort(server, config.port);
  const signing = normSecurityMode(config.signing_mode, "if-offered");
  const encryption = normSecurityMode(config.encryption_mode, "if-offered");

  const basePath = sanitizeRelativePath(config.base_path || "");
  const shareName = String(share).trim();

  const { Client } = await getSmb3Client();
  const client = new Client({
    host,
    port,
    domain: domain || "",
    username: username || "",
    password: password || "",
    connectTimeout: 10000,
    requestTimeout: 30000,
    signing,
    encryption,
  });

  await client.connect();

  /**
   * Combine share + basePath + user-supplied relative into the full
   * smb3-client-style path ("share/sub/dir/file.ext"), always sanitising
   * the user input first.
   */
  function resolvePath(rel) {
    const safe = sanitizeRelativePath(rel);
    return [shareName, basePath, safe].filter(Boolean).join("/");
  }

  /**
   * Convert a smb3-client Dirent + best-effort stat into the shape the
   * rest of the plugin expects (`name`, `isDirectory` as function OR
   * boolean, `size`, `mtime`, `birthtime`).
   *
   * We fetch stat data in parallel because smb3-client's readdir Dirent
   * only carries name/isFile/isDirectory. For very large directories this
   * would fan out into many stat calls — that's an acceptable trade-off
   * for now; a future release can optimise by using SMB2_QUERY_DIRECTORY's
   * FileBothDirectoryInformation output directly.
   */
  async function enrichEntry(dirent, parentFullPath) {
    const isDir = !!dirent.isDirectory();
    const fullPath = parentFullPath
      ? parentFullPath + "/" + dirent.name
      : dirent.name;
    let size = 0;
    let mtime;
    let birthtime;
    try {
      const st = await client.stat(fullPath);
      size = Number(st.size || 0);
      mtime = st.mtime;
      birthtime = st.ctime;
    } catch (_) {
      // Non-fatal; return whatever we already have.
    }
    return {
      name: dirent.name,
      isDirectory: isDir,
      size,
      mtime,
      birthtime,
    };
  }

  return {
    /** Share name, exposed for URL building / logging. */
    shareName,
    /** Sanitised base path (may be ""). */
    basePath,
    /** Underlying smb3-client Client — do not use unless you know why. */
    _raw: client,

    /**
     * List a directory (share root by default). Returns an array of objects
     * shaped like the legacy `@marsaud/smb2` output so index.js does not need
     * to change: `{ name, isDirectory, size, mtime, birthtime }`.
     */
    async readdir(rel) {
      const full = resolvePath(rel);
      const dirents = await client.readdir(full, { withFileTypes: true });
      // Parallel enrichment. Bounded to a reasonable concurrency to avoid
      // saturating the SMB session on huge directories.
      const CHUNK = 16;
      const result = [];
      for (let i = 0; i < dirents.length; i += CHUNK) {
        const slice = dirents.slice(i, i + CHUNK);
        const enriched = await Promise.all(
          slice.map((d) => enrichEntry(d, full))
        );
        result.push(...enriched);
      }
      return result;
    },

    /** Stat a single file/directory (name-relative-to-share/basePath). */
    async stat(rel) {
      const full = resolvePath(rel);
      const st = await client.stat(full);
      // Return a shape compatible with the old readdir-emulated stat.
      return {
        name: full.split("/").pop(),
        size: Number(st.size || 0),
        mtime: st.mtime,
        birthtime: st.ctime,
        isDirectory: !!st.isDirectory,
        isFile: !!st.isFile,
      };
    },

    /** Read the full content of a file into a Buffer. */
    async readFile(rel) {
      return await client.readFile(resolvePath(rel));
    },

    /** Create or overwrite a file with the given Buffer / string. */
    async writeFile(rel, data) {
      return await client.writeFile(resolvePath(rel), data);
    },

    /** Check whether a path exists (never throws). */
    async exists(rel) {
      try {
        await client.stat(resolvePath(rel));
        return true;
      } catch (_) {
        return false;
      }
    },

    /** Delete a single file. */
    async unlink(rel) {
      return await client.rm(resolvePath(rel));
    },

    /** Remove an empty directory. */
    async rmdir(rel) {
      return await client.rmdir(resolvePath(rel));
    },

    /** Create a directory (non-recursive). */
    async mkdir(rel) {
      return await client.mkdir(resolvePath(rel));
    },

    /** Rename (or move within the same share). */
    async rename(oldRel, newRel) {
      return await client.rename(resolvePath(oldRel), resolvePath(newRel));
    },

    /**
     * Streaming read — returns a Node Readable. Note: unlike the callback-
     * based old API this is synchronous (smb3-client's own signature).
     */
    createReadStream(rel) {
      return client.createReadStream(resolvePath(rel));
    },

    /** Streaming write. */
    createWriteStream(rel) {
      return client.createWriteStream(resolvePath(rel));
    },

    /** Tear down the SMB session and TCP socket. Always await this. */
    async disconnect() {
      try {
        await client.close();
      } catch (_) {
        // ignore — best-effort teardown
      }
    },
  };
}

/**
 * Execute a callback with a fresh SMB client and always disconnect afterwards.
 * Prefer this helper over building a long-lived client because SMB sessions
 * time out on idle and smb3-client does not currently expose a reconnect
 * primitive.
 */
async function withClient(config, fn) {
  const client = await buildClient(config);
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
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
