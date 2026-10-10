/**
 * Tests für Mehrfachverbindungen, Rechte und Fehlermeldungen (ab v0.5.0).
 * Ausführen: `node test/connections.test.js` (Exit-Code 0 = Erfolg).
 */

"use strict";

const assert = require("assert");
const {
  DEFAULT_CONNECTION,
  isEnabled,
  normaliseConnectionName,
  buildConnections,
  connectionEntriesForForm,
  isListFormat,
  CONNECTION_KEYS,
  listConnections,
  resolveConnection,
  connectionOptions,
  canRead,
  canWrite,
  permissionsFor,
} = require("../connections");
const { resolveViewConnection } = require("../view-common");
const { explainSmbError } = require("../smb-errors");

let failed = 0;
function runTest(name, fn) {
  try {
    fn();
    console.log("ok  " + name);
  } catch (e) {
    failed++;
    console.error("FAIL " + name + " – " + (e.message || e));
  }
}

const req = (role) => ({ user: { role_id: role } });
/** buildConnections liefert ein Array – für die Tests nach Kennung indizieren. */
const byName = (cfg) => {
  const r = buildConnections(cfg);
  return { problems: r.problems, connections: Object.fromEntries(r.connections.map((c) => [c.name, c])) };
};
const BASE = {
  server: "srv1",
  share: "docs",
  username: "svc",
  password: "geheim",
  allow_upload: true,
  allow_mkdir: "on",
  max_upload_mb: 20,
  connections: [
    { name: "archiv", label: "Archiv", server: "srv2", share: "archiv", password: "p2" },
    { name: "ro", server: "srv2", share: "archiv", read_only: true },
    { name: "admins", server: "srv3", share: "x", min_role_read: 1, min_role_write: "" },
  ],
};

// ==== isEnabled =============================================================
runTest("isEnabled: true/on/1/'true'", () =>
  [true, "on", 1, "1", "true"].forEach((v) => assert.strictEqual(isEnabled(v), true)));
runTest("isEnabled: undefined/false/''/0 → false", () =>
  [undefined, null, false, "", 0, "0", "false"].forEach((v) => assert.strictEqual(isEnabled(v), false)));

// ==== Kennungen ===========================================================
runTest("name: leer → default", () => assert.strictEqual(normaliseConnectionName(""), DEFAULT_CONNECTION));
runTest("name: trimmt", () => assert.strictEqual(normaliseConnectionName("  archiv "), "archiv"));
runTest("name: Pfad-Traversal abgelehnt", () => assert.throws(() => normaliseConnectionName("../etc")));
runTest("name: Leerzeichen abgelehnt", () => assert.throws(() => normaliseConnectionName("a b")));
runTest("name: zu lang abgelehnt", () => assert.throws(() => normaliseConnectionName("a".repeat(41))));

// ==== buildConnections ====================================================
runTest("build: Legacy-Felder = default", () => {
  const { connections } = byName(BASE);
  assert.strictEqual(connections.default.server, "srv1");
  assert.strictEqual(connections.default.share, "docs");
});
runTest("build: Zusatzverbindungen übernommen", () => {
  const { connections } = byName(BASE);
  assert.deepStrictEqual(Object.keys(connections).sort(), ["admins", "archiv", "default", "ro"]);
  assert.strictEqual(connections.archiv.password, "p2");
});
runTest("build: globale Einstellungen werden geerbt", () => {
  const c = byName(BASE).connections.archiv;
  assert.strictEqual(c.max_upload_mb, 20);
  assert.strictEqual(c.allow_upload, true);
});
runTest("build: Zugangsdaten werden NICHT von default geerbt", () => {
  const c = byName(BASE).connections.ro;
  assert.ok(!c.password, "ro darf nicht das Passwort von default bekommen");
  assert.ok(!c.username || c.username !== "svc");
});
runTest("build: doppelte Kennung → Problem, erster Eintrag gewinnt", () => {
  const cfg = { ...BASE, connections: [...BASE.connections, { name: "archiv", server: "z", share: "z" }] };
  const { connections, problems } = byName(cfg);
  assert.strictEqual(connections.archiv.server, "srv2");
  assert.ok(problems.some((p) => /archiv/.test(p)));
});
runTest("Altformat: Listeneintrag 'default' kollidiert mit Einzelverbindung", () => {
  const { connections, problems } = byName({ ...BASE, connections: [{ name: "default", server: "evil", share: "x" }] });
  assert.strictEqual(connections.default.server, "srv1");
  assert.strictEqual(problems.length, 1);
});
runTest("build: fehlender Server/Share → Problem", () => {
  const { connections, problems } = byName({ ...BASE, connections: [{ name: "leer" }] });
  assert.ok(!connections.leer);
  assert.strictEqual(problems.length, 1);
});
runTest("build: connections als JSON-String toleriert", () => {
  const { connections } = byName({ ...BASE, connections: JSON.stringify(BASE.connections) });
  assert.ok(connections.archiv);
});
runTest("build: leere Konfiguration wirft nicht", () => {
  const { connections } = buildConnections({});
  assert.ok(typeof connections === "object");
});

// ==== resolve / list =======================================================
runTest("resolve: ohne Name → default", () => assert.strictEqual(resolveConnection(BASE).name, "default"));
runTest("resolve: archiv", () => assert.strictEqual(resolveConnection(BASE, "archiv").server, "srv2"));
runTest("resolve: unbekannt → 404", () => {
  try { resolveConnection(BASE, "gibtsnicht"); assert.fail("kein Fehler"); }
  catch (e) { assert.strictEqual(e.status, 404); }
});
runTest("resolve: ungültig → 400", () => {
  try { resolveConnection(BASE, "../x"); assert.fail("kein Fehler"); }
  catch (e) { assert.strictEqual(e.status, 400); }
});
runTest("resolve: default unkonfiguriert → 500", () => {
  try { resolveConnection({}, "default"); assert.fail("kein Fehler"); }
  catch (e) { assert.strictEqual(e.status, 500); }
});
runTest("list: nur gültige Verbindungen, default zuerst", () =>
  assert.deepStrictEqual(listConnections(BASE).map((c) => c.name), ["default", "archiv", "ro", "admins"]));
runTest("options: nur Kennungen – keine Zugangsdaten", () => {
  const s = JSON.stringify(connectionOptions(BASE));
  assert.ok(!/geheim|p2|svc/.test(s), s);
});
runTest("options: default zuerst, auch wenn unkonfiguriert", () =>
  assert.strictEqual(connectionOptions({ connections: BASE.connections })[0], "default"));

// ==== Rechte ================================================================
const conns = byName(BASE).connections;
runTest("read: Standard 80 – User ja, Public nein", () => {
  assert.strictEqual(canRead(req(80), conns.default), true);
  assert.strictEqual(canRead(req(100), conns.default), false);
  assert.strictEqual(canRead({}, conns.default), false);
});
runTest("read: Override min_role_read=1", () => {
  assert.strictEqual(canRead(req(1), conns.admins), true);
  assert.strictEqual(canRead(req(40), conns.admins), false);
});
runTest("write: Standard 40 – Staff ja, User nein", () => {
  assert.strictEqual(canWrite(req(40), conns.default), true);
  assert.strictEqual(canWrite(req(80), conns.default), false);
});
runTest("write: read_only sperrt auch Admin", () => assert.strictEqual(canWrite(req(1), conns.ro), false));
runTest("write: min_role_write=100 sperrt alles", () =>
  assert.strictEqual(canWrite(req(1), { ...conns.default, min_role_write: 100 }), false));
runTest("perms: allow_* nur wenn aktiviert UND Schreibrecht", () => {
  const p = permissionsFor(req(1), conns.default);
  assert.strictEqual(p.allowUpload, true);
  assert.strictEqual(p.allowMkdir, true);
  assert.strictEqual(p.allowDelete, false, "allow_delete nicht gesetzt → aus");
  assert.strictEqual(p.allowRename, false);
  assert.strictEqual(p.maxUploadMb, 20);
});
runTest("perms: read_only → keine Schreib-Buttons", () => {
  const p = permissionsFor(req(1), conns.ro);
  assert.strictEqual(p.readOnly, true);
  assert.strictEqual(p.allowUpload, false);
  assert.strictEqual(p.allowMkdir, false);
});

// ==== View-Verbindung =======================================================
runTest("view: ohne Angabe → default", () => assert.strictEqual(resolveViewConnection({}, null), "default"));
runTest("view: statische Verbindung", () => assert.strictEqual(resolveViewConnection({ connection: "archiv" }, null), "archiv"));
runTest("view: Zeilenfeld überschreibt", () =>
  assert.strictEqual(resolveViewConnection({ connection: "archiv", connection_field: "fs" }, { fs: "ro" }), "ro"));
runTest("view: leeres Zeilenfeld → statische Verbindung", () =>
  assert.strictEqual(resolveViewConnection({ connection: "archiv", connection_field: "fs" }, { fs: "" }), "archiv"));
runTest("view: ungültiger Zeilenwert wirft", () =>
  assert.throws(() => resolveViewConnection({ connection_field: "fs" }, { fs: "a/b" })));

// ==== Fehlermeldungen =======================================================
runTest("smb-error: ACCESS_DENIED verständlich", () =>
  assert.ok(/Zugriff verweigert|keine Berechtigung/i.test(explainSmbError(new Error("STATUS_ACCESS_DENIED"), { username: "svc" }))));
runTest("smb-error: NAME_COLLISION", () =>
  assert.ok(/existiert bereits/i.test(explainSmbError(new Error("STATUS_OBJECT_NAME_COLLISION")))));
runTest("smb-error: Netzwerk", () =>
  assert.ok(/nicht erreichbar/.test(explainSmbError(new Error("connect ECONNREFUSED"), { server: "srv9" }))));
runTest("smb-error: unbekannt → Originaltext", () =>
  assert.strictEqual(explainSmbError(new Error("irgendwas")), "irgendwas"));

// ==== Listenformat ab v0.7.0 =================================================
const V2 = {
  connections_v2: "1",
  allow_upload: true,
  // Altlasten aus früheren Versionen – müssen im Listenformat ignoriert werden:
  server: "alt-server",
  share: "alt-share",
  password: "alt-pw",
  connections: [
    { name: "hq", label: "Zentrale", server: "srv-hq", share: "daten", password: "p-hq" },
    { name: "werk2", server: "srv-w2", share: "daten" },
  ],
};
runTest("v2: alte Einzelfelder werden ignoriert", () => {
  const names = listConnections(V2).map((c) => c.name);
  assert.deepStrictEqual(names, ["hq", "werk2"]);
});
runTest("v2: 'default' ohne Eintrag → erster Eintrag", () =>
  assert.strictEqual(resolveConnection(V2, "default").name, "hq"));
runTest("v2: leere Kennung → Standardverbindung", () =>
  assert.strictEqual(resolveConnection(V2, "").name, "hq"));
runTest("v2: default_connection wählt die Standardverbindung", () =>
  assert.strictEqual(resolveConnection({ ...V2, default_connection: "werk2" }, "default").name, "werk2"));
runTest("v2: default_connection unbekannt → Problem + erster Eintrag", () => {
  const r = buildConnections({ ...V2, default_connection: "weg" });
  assert.strictEqual(r.defaultName, "hq");
  assert.ok(r.problems.some((p) => /weg/.test(p)));
});
runTest("v2: Eintrag namens 'default' ist normal nutzbar", () => {
  const cfg = { ...V2, connections: [{ name: "x", server: "a", share: "b" }, { name: "default", server: "d", share: "e" }] };
  assert.strictEqual(resolveConnection(cfg, "default").server, "d");
});
runTest("v2: gewählte Standardverbindung hat Vorrang vor Eintrag 'default'", () => {
  const cfg = { ...V2, default_connection: "x", connections: [{ name: "x", server: "a", share: "b" }, { name: "default", server: "d", share: "e" }] };
  assert.strictEqual(resolveConnection(cfg, "default").name, "x");
});
runTest("v2: Dropdown bietet 'default' (Standard) + alle Kennungen", () =>
  assert.deepStrictEqual(connectionOptions(V2), ["default", "hq", "werk2"]));
runTest("v2: fehlende Kennung → Problem", () => {
  const r = buildConnections({ ...V2, connections: [{ server: "a", share: "b" }] });
  assert.strictEqual(r.connections.length, 0);
  assert.ok(/Kennung fehlt/.test(r.problems[0]));
});
runTest("isListFormat", () => {
  assert.strictEqual(isListFormat(V2), true);
  assert.strictEqual(isListFormat(BASE), false);
});

// ==== Übernahme bestehender Installationen ==================================
runTest("Altformat: Formular zeigt Einzelverbindung als ersten Eintrag", () => {
  const e = connectionEntriesForForm(BASE);
  assert.deepStrictEqual(e.map((x) => x.name), ["default", "archiv", "ro", "admins"]);
  assert.strictEqual(e[0].server, "srv1");
  assert.strictEqual(e[0].password, "geheim");
});
runTest("Altformat: Laufzeit unverändert (ohne Speichern)", () => {
  assert.strictEqual(resolveConnection(BASE, "default").server, "srv1");
  assert.strictEqual(resolveConnection(BASE, "archiv").server, "srv2");
});
runTest("Speichern simuliert (Saltcorn: {...alt, ...neu}) → gleiche Auflösung", () => {
  const values = { connections: connectionEntriesForForm(BASE), connections_v2: "1" };
  for (const k of CONNECTION_KEYS) values[k] = "";
  const saved = { ...BASE, ...values };
  assert.strictEqual(isListFormat(saved), true);
  for (const n of ["default", "archiv", "ro", "admins"]) {
    const before = resolveConnection(BASE, n);
    const after = resolveConnection(saved, n);
    assert.strictEqual(after.server, before.server, n);
    assert.strictEqual(after.share, before.share, n);
    assert.strictEqual(String(after.password || ""), String(before.password || ""), n);
    assert.strictEqual(after.read_only, before.read_only, n);
    assert.strictEqual(after.min_role_read, before.min_role_read, n);
  }
  assert.strictEqual(saved.password, "", "altes Einzel-Passwort geleert");
});
runTest("Erneutes Öffnen nach dem Speichern: keine doppelte Übernahme", () => {
  const values = { connections: connectionEntriesForForm(BASE), connections_v2: "1" };
  const saved = { ...BASE, ...values };
  assert.strictEqual(connectionEntriesForForm(saved).length, 4);
});
runTest("Leere Neuinstallation: keine Verbindung, kein Fehler", () => {
  assert.deepStrictEqual(connectionEntriesForForm({}), []);
  assert.deepStrictEqual(connectionOptions({}), ["default"]);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nall connection tests passed");
