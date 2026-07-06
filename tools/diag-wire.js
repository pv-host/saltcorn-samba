#!/usr/bin/env node
/**
 * diag-wire.js — Wire-level QUERY_DIRECTORY diagnostic.
 *
 * Opens a connection, tree-connects, opens the target directory, then sends
 * a hand-built QUERY_DIRECTORY packet with FULL HEX DUMP of both request
 * and response. This bypasses smb3-client's encoders so we can compare bytes.
 *
 * Usage (from the plugin directory):
 *   node tools/diag-wire.js \
 *     --host 192.168.110.10 --share buero --user 01_vassen \
 *     --domain buero.ib-vassen.de --password '...' \
 *     --path static
 */

"use strict";

const fs = require("fs");
const path = require("path");
const url = require("url");

async function loadInternals() {
  const candidates = [
    path.join(__dirname, "..", "node_modules", "smb3-client"),
    path.join(__dirname, "..", "..", "node_modules", "smb3-client"),
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
    throw new Error("smb3-client not found in node_modules");
  }
  const distDir = path.join(smb3Root, "dist");
  const load = (rel) => import(url.pathToFileURL(path.join(distDir, rel)).href);

  const [
    idx,
    bufMod,
    qdMod,
    cmdMod,
    qiMod,
    createStructMod,
    pathsMod,
    errMod,
    openMod,
  ] = await Promise.all([
    load("index.js"),
    load("wire/buffer.js"),
    load("wire/structs/queryDirectory.js"),
    load("wire/commands.js"),
    load("wire/structs/queryInfo.js"),
    load("wire/structs/create.js"),
    load("paths.js"),
    load("errors.js"),
    load("open/open.js"),
  ]);

  return {
    Client: idx.Client,
    Writer: bufMod.Writer,
    encodeQueryDirectoryRequest: qdMod.encodeQueryDirectoryRequest,
    decodeQueryDirectoryResponse: qdMod.decodeQueryDirectoryResponse,
    parseFileIdBothDirectoryInformation: qdMod.parseFileIdBothDirectoryInformation,
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
    splitSharePath: pathsMod.splitSharePath,
    toSmbPath: pathsMod.toSmbPath,
    SmbError: errMod.SmbError,
    Open: openMod.Open,
  };
}

function hex(buf, label) {
  console.log(`\n--- ${label} (${buf.length} bytes) ---`);
  for (let off = 0; off < buf.length; off += 16) {
    const slice = buf.slice(off, Math.min(off + 16, buf.length));
    const hexPart = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(48);
    const asciiPart = Array.from(slice)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    console.log(
      `${off.toString(16).padStart(4, "0")}  ${hexPart}  ${asciiPart}`
    );
  }
}

// Build QUERY_DIRECTORY body byte-by-byte with named fields
function buildQdBody(I, opts) {
  const {
    fileInformationClass,
    flags,
    fileIndex,
    fileId,
    searchPattern,
    outputBufferLength,
    forceFileNameOffsetZero, // testing variant
  } = opts;

  const pat = Buffer.from(searchPattern, "utf16le");
  const w = new I.Writer();
  w.u16(33); // StructureSize
  w.u8(fileInformationClass);
  w.u8(flags);
  w.u32(fileIndex);
  w.bytes(fileId); // 16
  const fileNameOffset = forceFileNameOffsetZero
    ? 0
    : pat.length === 0
      ? 0
      : 64 + 32;
  w.u16(fileNameOffset);
  w.u16(pat.length);
  w.u32(outputBufferLength);
  if (pat.length === 0) {
    w.u8(0); // pad byte
  } else {
    w.bytes(pat);
  }
  return w.buffer();
}

async function sendRaw(open, I, opts, label) {
  const body = buildQdBody(I, opts);
  hex(body, `${label} REQUEST BODY`);
  console.log(
    `Fields: StructSize=33, FileInformationClass=${opts.fileInformationClass}, ` +
      `Flags=${opts.flags}, FileNameLength=${
        Buffer.from(opts.searchPattern, "utf16le").length
      }, ` +
      `OutputBufferLength=${opts.outputBufferLength}`
  );
  const fnOff = body.readUInt16LE(32 - 8);
  console.log(`FileNameOffset (from body): ${fnOff}`);

  const signing = open.tree.session.makeSigning();
  try {
    const resp = await open.tree.conn.send(I.SmbCommand.QUERY_DIRECTORY, body, {
      sessionId: open.tree.session.sessionId,
      treeId: open.tree.treeId,
      ...(signing !== undefined ? { signing } : {}),
      encrypt: open.tree.encryptRequired,
      creditCharge: 1,
    });
    console.log(
      `RESPONSE status: 0x${resp.header.status.toString(16)} (${I.statusName(
        resp.header.status
      )})`
    );
    hex(resp.body.slice(0, Math.min(resp.body.length, 128)), `${label} RESPONSE BODY (first 128)`);
    if (I.isSuccess(resp.header.status)) {
      const buf = I.decodeQueryDirectoryResponse(resp.body, 64);
      const items = I.parseFileIdBothDirectoryInformation(buf);
      console.log(
        `Decoded ${items.length} entries: ${items.slice(0, 5).map((e) => e.fileName).join(", ")}`
      );
    }
    return resp;
  } catch (e) {
    console.log(`SEND ERROR: ${e.message}`);
    if (e.status) console.log(`  NT status: 0x${e.status.toString(16)}`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["host", "share", "user", "path"];
  for (const k of required) {
    if (!args[k]) {
      console.error(`missing required --${k}`);
      process.exit(2);
    }
  }
  const password = args.password || process.env.SMB_PASSWORD || "";
  if (!password) {
    console.error("missing --password");
    process.exit(2);
  }

  const I = await loadInternals();

  const client = new I.Client({
    host: args.host,
    port: Number(args.port) || 445,
    domain: args.domain || "",
    username: args.user,
    password,
    connectTimeout: 10000,
    requestTimeout: 30000,
    signing: args.signing || "if-offered",
    encryption: args.encryption || "if-offered",
  });

  console.log("Connecting…");
  await client.connect();
  console.log("Connected");

  const fullPath = `${args.share}/${args.path}`;
  const { share, rest } = I.splitSharePath(fullPath);
  const tree = await client.treeFor(share);
  console.log(`Tree connected: treeId=${tree.treeId}`);

  // Open the target directory
  const open = await I.Open.create(tree, {
    filename: I.toSmbPath(rest),
    desiredAccess:
      I.FileAccess.FILE_READ_DATA | I.FileAccess.FILE_READ_ATTRIBUTES,
    shareAccess: I.ShareAccess.READ | I.ShareAccess.WRITE | I.ShareAccess.DELETE,
    createDisposition: I.CreateDisposition.OPEN,
    createOptions: I.CreateOptions.DIRECTORY_FILE,
    fileAttributes: 0,
  });
  console.log(`Opened dir, fileId hex: ${open.fileId.toString("hex")}`);

  // ---------------- 6 probes ----------------
  console.log("\n============ PROBE 1: pat='*', flags=RESTART, class=FileIdBothDir ============");
  await sendRaw(
    open,
    I,
    {
      fileInformationClass: I.FileInformationClass.FileIdBothDirectoryInformation,
      flags: I.QueryDirectoryFlag.RESTART_SCANS,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: "*",
      outputBufferLength: 65536,
    },
    "P1"
  );

  console.log("\n============ PROBE 2: pat='*', flags=0, class=FileIdBothDir ============");
  await sendRaw(
    open,
    I,
    {
      fileInformationClass: I.FileInformationClass.FileIdBothDirectoryInformation,
      flags: 0,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: "*",
      outputBufferLength: 65536,
    },
    "P2"
  );

  console.log("\n============ PROBE 3: pat='*', flags=RESTART, class=FileBothDir (0x03) ============");
  await sendRaw(
    open,
    I,
    {
      fileInformationClass: I.FileInformationClass.FileBothDirectoryInformation ?? 3,
      flags: I.QueryDirectoryFlag.RESTART_SCANS,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: "*",
      outputBufferLength: 65536,
    },
    "P3"
  );

  console.log("\n============ PROBE 4: pat='*', flags=RESTART, class=FileDirInfo (0x01) ============");
  await sendRaw(
    open,
    I,
    {
      fileInformationClass: I.FileInformationClass.FileDirectoryInformation ?? 1,
      flags: I.QueryDirectoryFlag.RESTART_SCANS,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: "*",
      outputBufferLength: 65536,
    },
    "P4"
  );

  console.log("\n============ PROBE 5: pat='*', outBuf=8192, flags=RESTART ============");
  await sendRaw(
    open,
    I,
    {
      fileInformationClass: I.FileInformationClass.FileIdBothDirectoryInformation,
      flags: I.QueryDirectoryFlag.RESTART_SCANS,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: "*",
      outputBufferLength: 8192,
    },
    "P5"
  );

  console.log("\n============ PROBE 6: pat='', flags=RESTART (empty pattern, offset=0) ============");
  await sendRaw(
    open,
    I,
    {
      fileInformationClass: I.FileInformationClass.FileIdBothDirectoryInformation,
      flags: I.QueryDirectoryFlag.RESTART_SCANS,
      fileIndex: 0,
      fileId: open.fileId,
      searchPattern: "",
      outputBufferLength: 65536,
    },
    "P6"
  );

  console.log("\nAvailable FileInformationClass values:");
  console.log(JSON.stringify(I.FileInformationClass, null, 2));

  try {
    await open.close();
  } catch (_) {}
  try {
    await client.close();
  } catch (_) {}
  console.log("\nDone.");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (!nxt || nxt.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = nxt;
        i++;
      }
    }
  }
  return out;
}

main().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
