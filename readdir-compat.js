"use strict";

/**
 * readdir-compat.js  —  saltcorn-samba 0.4.14
 *
 * Behebt zwei QUERY_DIRECTORY-Wire-Bugs in smb3-client@0.2.0 die
 * gegen Samba 4.23 zu STATUS_OBJECT_NAME_INVALID (0xC0000033) führen.
 *
 * BUG 1 (leeres Pattern auf Folge-Pages)  ─ Hauptursache des 0xC0000033:
 *   smb3-client's `readdirAll` sendet ab der 2. Enumeration-Page
 *   `searchPattern=""`. Windows toleriert das, Samba 4.23 lehnt es
 *   strikt ab: `source3/smbd/smb2_query_directory.c` prüft
 *   `in_file_name[0] == '\0'` und antwortet mit
 *   STATUS_OBJECT_NAME_INVALID.
 *   Fix (in readdirAllFixed): Auf jeder Page `*` senden. RESTART_SCANS
 *   nur beim ersten Request. Samba beendet nach der letzten Seite
 *   sauber mit STATUS_NO_MORE_FILES.
 *
 * BUG 2 (FileNameOffset bei leerem Pattern) ─ defensiv abgefangen:
 *   smb3-client's `encodeQueryDirectoryRequest` setzt `FileNameOffset`
 *   immer auf 96 — auch wenn `FileNameLength === 0` gesendet wird.
 *   MS-SMB2 §2.2.33 verlangt für diesen Fall FileNameOffset = 0.
 *   Da wir seit Bug-1-Fix ohnehin nie mit leerem Pattern senden, kann
 *   dieser Bug nicht mehr getriggert werden — encodeQueryDirectory-
 *   RequestFixed behandelt den Fall trotzdem spec-konform, falls ein
 *   Aufrufer den Encoder direkt benutzt oder ein zukünftiger Server
 *   noch strenger prüft.
 *
 * Strategie:
 *   Statt smb3-client's `client.readdir()` / `readdirAll` verwenden wir
 *   einen eigenen Loop, der `Open.withOpen` von smb3-client wieder-
 *   verwendet (Open, Close, Tree-Connect bleiben unverändert) und nur
 *   die kaputte QUERY_DIRECTORY-Loop durch eine spec-konforme ersetzt.
 *
 * Die internen wire-Module werden via `file://` URL geladen, weil
 * smb3-client's `exports`-Gate keine Subpath-Imports über den
 * Package-Namen zulässt (nicht einmal `smb3-client/package.json`).
 */

const fs = require("fs");
const path = require("path");
const url = require("url");

let LOAD_PROMISE = null;
let INTERNALS = null;

/**
 * Interne Wire-/Path-Module aus smb3-client laden. Lazy + gecached.
 * Wirft, wenn smb3-client nicht auffindbar oder Interna verändert.
 */
function loadInternals() {
  if (INTERNALS) return Promise.resolve(INTERNALS);
  if (LOAD_PROMISE) return LOAD_PROMISE;

  LOAD_PROMISE = (async () => {
    // smb3-client-Root finden (package.json ist via exports-Gate blockiert,
    // wir gehen über den Ordner-Pfad)
    const candidates = [
      path.join(__dirname, "node_modules", "smb3-client"),
      path.join(__dirname, "..", "node_modules", "smb3-client"),
      path.join(__dirname, "..", "..", "node_modules", "smb3-client"),
      path.join(__dirname, "..", "..", "..", "node_modules", "smb3-client"),
    ];
    let smb3Root = null;
    for (const c of candidates) {
      try {
        fs.accessSync(path.join(c, "dist", "index.js"));
        smb3Root = c;
        break;
      } catch (_) {}
    }
    if (!smb3Root) {
      throw new Error(
        "readdir-compat: smb3-client-Installation nicht gefunden. " +
          "Erwartet in node_modules/smb3-client relativ zu " +
          __dirname
      );
    }

    const distDir = path.join(smb3Root, "dist");
    const load = (rel) =>
      import(url.pathToFileURL(path.join(distDir, rel)).href);

    const [
      bufMod,
      qdMod,
      cmdMod,
      qiMod,
      createStructMod,
      pathsMod,
      errMod,
      openMod,
    ] = await Promise.all([
      load("wire/buffer.js"),
      load("wire/structs/queryDirectory.js"),
      load("wire/commands.js"),
      load("wire/structs/queryInfo.js"),
      load("wire/structs/create.js"),
      load("paths.js"),
      load("errors.js"),
      load("open/open.js"),
    ]);

    if (typeof bufMod.Writer !== "function")
      throw new Error("readdir-compat: Writer-Klasse fehlt");
    if (typeof qdMod.decodeQueryDirectoryResponse !== "function")
      throw new Error("readdir-compat: decodeQueryDirectoryResponse fehlt");
    if (typeof qdMod.parseFileIdBothDirectoryInformation !== "function")
      throw new Error("readdir-compat: parseFileIdBothDirectoryInformation fehlt");
    if (typeof openMod.Open !== "function")
      throw new Error("readdir-compat: Open-Klasse fehlt");

    INTERNALS = {
      smb3Root,
      Writer: bufMod.Writer,
      decodeQueryDirectoryResponse: qdMod.decodeQueryDirectoryResponse,
      parseFileIdBothDirectoryInformation:
        qdMod.parseFileIdBothDirectoryInformation,
      QueryDirectoryFlag: qdMod.QueryDirectoryFlag,
      SmbCommand: cmdMod.SmbCommand,
      NTStatus: cmdMod.NTStatus,
      isSuccess: cmdMod.isSuccess,
      statusName: cmdMod.statusName,
      FileInformationClass: qiMod.FileInformationClass,
      FileAccess: createStructMod.FileAccess,
      ShareAccess: createStructMod.ShareAccess,
      CreateDisposition: createStructMod.CreateDisposition,
      CreateOptions: createStructMod.CreateOptions,
      FileAttribute: createStructMod.FileAttribute,
      splitSharePath: pathsMod.splitSharePath,
      toSmbPath: pathsMod.toSmbPath,
      smbTimeToDate: pathsMod.smbTimeToDate,
      SmbError: errMod.SmbError,
      Open: openMod.Open,
    };
    return INTERNALS;
  })();

  return LOAD_PROMISE;
}

/**
 * Spec-konformer Encoder für SMB2 QUERY_DIRECTORY (MS-SMB2 §2.2.33).
 *
 * Unterschied zum Original in smb3-client@0.2.0:
 *   `FileNameOffset` wird auf 0 gesetzt, wenn `pat.length === 0`
 *   (statt hart auf 64+32=96). MS-SMB2 §2.2.33 verlangt bei
 *   `FileNameLength=0` genau `FileNameOffset=0`.
 *
 * In der aktuellen Compat-Loop wird immer `pat="*"` gesendet, daher
 * wird dieser Zweig nie erreicht. Er bleibt als defensive Absicherung
 * gegen Aufrufer, die den Encoder direkt mit leerem Pattern nutzen.
 */
function encodeQueryDirectoryRequestFixed(I, req) {
  const pat = req.searchPattern
    ? Buffer.from(req.searchPattern, "utf16le")
    : Buffer.alloc(0);
  const w = new I.Writer();
  w.u16(33); // StructureSize
  w.u8(req.fileInformationClass);
  w.u8(req.flags);
  w.u32(req.fileIndex);
  w.bytes(req.fileId); // 16 bytes
  w.u16(pat.length === 0 ? 0 : 64 + 32);
  w.u16(pat.length);
  w.u32(req.outputBufferLength);
  if (pat.length === 0) w.u8(0);
  else w.bytes(pat);
  return w.buffer();
}

/**
 * QUERY_DIRECTORY-Loop mit gepatchtem Encoder.
 *
 * Unterschiede zu smb3-client's readdirAll():
 *   1. Auf Folge-Pages wird `searchPattern="*"` gesendet (nicht "").
 *      Samba lehnt leere Patterns strikt ab (STATUS_OBJECT_NAME_INVALID).
 *   2. RESTART_SCANS nur beim ersten Request.
 *   3. Encoder setzt FileNameOffset=0 bei leerem Pattern (Fallback für
 *      andere kaputte Server, wird hier faktisch nie benutzt).
 */
async function readdirAllFixed(I, open) {
  const items = [];
  let first = true;
  for (;;) {
    const body = encodeQueryDirectoryRequestFixed(I, {
      fileInformationClass:
        I.FileInformationClass.FileIdBothDirectoryInformation,
      flags: first ? I.QueryDirectoryFlag.RESTART_SCANS : 0,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: "*", // IMMER "*", nie "" — Samba lehnt leer ab
      outputBufferLength: 65536,
    });
    first = false;

    const signing = open.tree.session.makeSigning();
    const resp = await open.tree.conn.send(
      I.SmbCommand.QUERY_DIRECTORY,
      body,
      {
        sessionId: open.tree.session.sessionId,
        treeId: open.tree.treeId,
        ...(signing !== undefined ? { signing } : {}),
        encrypt: open.tree.encryptRequired,
        creditCharge: 1,
      }
    );

    if (resp.header.status === I.NTStatus.STATUS_NO_MORE_FILES) break;
    if (!I.isSuccess(resp.header.status)) {
      throw new I.SmbError({
        status: resp.header.status,
        message:
          "QUERY_DIRECTORY (compat) failed: " +
          I.statusName(resp.header.status),
      });
    }

    const buf = I.decodeQueryDirectoryResponse(resp.body, 64);
    if (buf.length === 0) break;

    const page = I.parseFileIdBothDirectoryInformation(buf);
    for (const e of page) items.push(e);
    if (page.length === 0) break;
  }
  return items.filter((x) => x.fileName !== "." && x.fileName !== "..");
}

/**
 * Öffentliche API: readdirCompat(client, fullPath, opts)
 *
 * Drop-in-Ersatz für `client.readdir(fullPath, opts)` von smb3-client.
 *   fullPath: "share/rest/of/path"  (smb3-client-Konvention)
 *   opts:     { withFileTypes?: boolean }
 *
 * Rückgabe:
 *   opts.withFileTypes === true → Dirent[]  { name, isFile(), isDirectory() }
 *   sonst                       → string[]  Dateinamen
 *
 * Zusätzlich (ergänzend zur smb3-client-API) Rich-Objects auf Wunsch:
 *   opts.rich === true → RichDirent[]
 *     { name, size, isFile(), isDirectory(), mtime, ctime, atime,
 *       changeTime, attributes, hidden, system, readonly, archive }
 */
async function readdirCompat(client, fullPath, opts) {
  const I = await loadInternals();

  const { share, rest } = I.splitSharePath(fullPath);
  const tree = await client.treeFor(share);

  return I.Open.withOpen(
    tree,
    {
      filename: I.toSmbPath(rest),
      desiredAccess:
        I.FileAccess.FILE_READ_DATA | I.FileAccess.FILE_READ_ATTRIBUTES,
      shareAccess:
        I.ShareAccess.READ | I.ShareAccess.WRITE | I.ShareAccess.DELETE,
      createDisposition: I.CreateDisposition.OPEN,
      createOptions: I.CreateOptions.DIRECTORY_FILE, // 1
      fileAttributes: 0,
    },
    async (open) => {
      const entries = await readdirAllFixed(I, open);
      if (opts && opts.rich) {
        return entries.map((e) => {
          const attr = e.fileAttributes;
          const isDir = (attr & I.FileAttribute.DIRECTORY) !== 0;
          return {
            name: e.fileName,
            size: Number(e.endOfFile),
            attributes: attr,
            isFile: () => !isDir,
            isDirectory: () => isDir,
            mtime: I.smbTimeToDate(e.lastWriteTime),
            ctime: I.smbTimeToDate(e.creationTime),
            atime: I.smbTimeToDate(e.lastAccessTime),
            changeTime: I.smbTimeToDate(e.changeTime),
            hidden: (attr & 0x02) !== 0,
            system: (attr & 0x04) !== 0,
            readonly: (attr & 0x01) !== 0,
            archive: (attr & 0x20) !== 0,
          };
        });
      }
      if (opts && opts.withFileTypes) {
        return entries.map((e) => {
          const isDir =
            (e.fileAttributes & I.FileAttribute.DIRECTORY) !== 0;
          return {
            name: e.fileName,
            isFile: () => !isDir,
            isDirectory: () => isDir,
          };
        });
      }
      return entries.map((e) => e.fileName);
    }
  );
}

/** Für Diagnose: Vorabladen erzwingen und Interna prüfen. */
async function ensureLoaded() {
  await loadInternals();
  return { loaded: true, smb3Root: INTERNALS.smb3Root };
}

module.exports = {
  readdirCompat,
  ensureLoaded,
};
