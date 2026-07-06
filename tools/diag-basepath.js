#!/usr/bin/env node
/**
 * Standalone diagnostic script for saltcorn-samba.
 * Runs a series of individual SMB3 operations against a share so we can see
 * exactly which primitive fails and why. Prints raw NT status codes.
 *
 * Usage (from the plugin directory, so smb3-client resolves):
 *
 *   node tools/diag-basepath.js \
 *     --host 192.168.110.10 --share buero --user 01_vassen \
 *     --domain buero.ib-vassen.de --password '…' \
 *     --path static
 *
 * The script never writes; it only opens handles.
 */

"use strict";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["host", "share", "user", "path"];
  for (const k of required) {
    if (!args[k]) {
      console.error("missing required --" + k);
      process.exit(2);
    }
  }
  const password = args.password || process.env.SMB_PASSWORD || "";
  if (!password) {
    console.error("missing --password (or SMB_PASSWORD env var)");
    process.exit(2);
  }

  const { Client } = await import("smb3-client");

  const client = new Client({
    host: args.host,
    port: Number(args.port) || 445,
    domain: args.domain || "",
    username: args.user,
    password,
    connectTimeout: 10_000,
    requestTimeout: 30_000,
    signing: args.signing || "if-offered",
    encryption: args.encryption || "if-offered",
  });

  console.log("[1/7] Connecting …");
  await client.connect();
  console.log("      \u2713 TCP + Negotiate + Session-Setup + Auth OK");

  const share = args.share;
  const path = args.path;
  const shareAndPath = share + "/" + path;
  console.log("[2/7] TREE_CONNECT to \\\\" + args.host + "\\" + share + " \u2026");
  try {
    // Trigger TREE_CONNECT by touching the raw internal — but smb3-client
    // does that implicitly on the first per-share call. So instead we call
    // a cheap op below and let the connect surface the error there.
    console.log("      (deferred until first op)");
  } catch (e) {
    console.error("      \u2717 TREE_CONNECT failed:", e && e.message);
  }

  // --- Probes ------------------------------------------------------------
  const probes = [
    { label: "readdir(share)      \u2014 SHARE ROOT",           op: () => client.readdir(share) },
    { label: "readdir(share/'')   \u2014 empty subpath",         op: () => client.readdir(share + "/") },
    { label: "stat(share/path)    \u2014 target as-is",           op: () => client.stat(shareAndPath) },
    { label: "readdir(share/path) \u2014 target as-is",           op: () => client.readdir(shareAndPath) },
    { label: "readdir(share/PATH) \u2014 target uppercased",      op: () => client.readdir(share + "/" + path.toUpperCase()) },
    { label: "readdir(share/path.lc) \u2014 target lowercased",   op: () => client.readdir(share + "/" + path.toLowerCase()) },
  ];

  let step = 3;
  for (const p of probes) {
    console.log("[" + step + "/7] " + p.label);
    try {
      const r = await p.op();
      const preview = Array.isArray(r)
        ? " (" + r.length + " entries" +
          (r.length ? ", first: " +
            JSON.stringify(r.slice(0, 3).map((e) => (typeof e === "string" ? e : e.name))) : "") + ")"
        : " (" + JSON.stringify(r).slice(0, 120) + ")";
      console.log("      \u2713 OK" + preview);
    } catch (e) {
      console.log("      \u2717 " + (e && e.message ? e.message.split("\n")[0] : String(e)));
      if (e && e.status) console.log("        NT status: 0x" + e.status.toString(16));
      if (e && e.code)   console.log("        error code: " + e.code);
    }
    step++;
  }

  // smb3-client's Client has close(), not disconnect() — the old
  // marsaud API used disconnect. Use close() and ignore errors so a
  // failing probe still tears down cleanly.
  try { await client.close(); } catch (_) {}
  console.log("Done.");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (!nxt || nxt.startsWith("--")) { out[key] = true; }
      else { out[key] = nxt; i++; }
    }
  }
  return out;
}

main().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
