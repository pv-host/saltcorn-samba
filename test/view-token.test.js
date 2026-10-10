/**
 * Tests für signierte View-Tokens und die View-Bindung (ab v0.6.0).
 * Ausführen: `node test/view-token.test.js` (Exit-Code 0 = Erfolg).
 */

"use strict";

const assert = require("assert");
const {
  deriveKey,
  userIdOf,
  issueViewToken,
  verifyViewToken,
  isWithinRoot,
  needsRenewal,
} = require("../view-token");
const { restrictPermissions, bindingMode, tokenTtlSec, tokenFromRequest } = require("../view-binding");
const { assertRowPath, loadRowForView } = require("../view-common");

let failed = 0;
const pending = [];
function runTest(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      pending.push(
        r.then(
          () => console.log("ok  " + name),
          (e) => { failed++; console.error("FAIL " + name + " – " + (e.message || e)); }
        )
      );
      return;
    }
    console.log("ok  " + name);
  } catch (e) {
    failed++;
    console.error("FAIL " + name + " – " + (e.message || e));
  }
}
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const KEY = deriveKey("ein-langes-test-geheimnis", "public");
const req1 = { user: { id: 1, role_id: 40 } };
const claims = { c: "archiv", r: "kunden/42", w: true, h: false, l: true, u: 1, vn: "Akte" };
const NOW = 1_800_000_000;

// ==== Ausstellen / Prüfen ===================================================
runTest("roundtrip liefert Claims", () => {
  const c = verifyViewToken(issueViewToken(claims, KEY, 3600, NOW), KEY, req1, { nowSec: NOW + 10 });
  assert.strictEqual(c.c, "archiv");
  assert.strictEqual(c.r, "kunden/42");
  assert.strictEqual(c.w, true);
  assert.strictEqual(c.h, false);
});
runTest("Signatur verändert → INVALID", () => {
  const t = issueViewToken(claims, KEY, 3600, NOW);
  const bad = t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA");
  assert.strictEqual(codeOf(() => verifyViewToken(bad, KEY, req1, { nowSec: NOW })), "VIEW_TOKEN_INVALID");
});
runTest("Payload verändert (Root leer) → INVALID", () => {
  const [, sig] = issueViewToken(claims, KEY, 3600, NOW).split(".");
  const forged = Buffer.from(JSON.stringify({ ...claims, v: 1, r: "", e: NOW + 999 })).toString("base64url");
  assert.strictEqual(codeOf(() => verifyViewToken(forged + "." + sig, KEY, req1, { nowSec: NOW })), "VIEW_TOKEN_INVALID");
});
runTest("anderer Schlüssel → INVALID", () => {
  const t = issueViewToken(claims, deriveKey("anderes-geheimnis-xyz", "public"), 3600, NOW);
  assert.strictEqual(codeOf(() => verifyViewToken(t, KEY, req1, { nowSec: NOW })), "VIEW_TOKEN_INVALID");
});
runTest("anderer Mandant → INVALID", () => {
  const t = issueViewToken(claims, deriveKey("ein-langes-test-geheimnis", "mandant2"), 3600, NOW);
  assert.strictEqual(codeOf(() => verifyViewToken(t, KEY, req1, { nowSec: NOW })), "VIEW_TOKEN_INVALID");
});
runTest("abgelaufen → EXPIRED", () => {
  const t = issueViewToken(claims, KEY, 3600, NOW);
  assert.strictEqual(codeOf(() => verifyViewToken(t, KEY, req1, { nowSec: NOW + 3601 })), "VIEW_TOKEN_EXPIRED");
});
runTest("anderer Benutzer → USER", () => {
  const t = issueViewToken(claims, KEY, 3600, NOW);
  assert.strictEqual(codeOf(() => verifyViewToken(t, KEY, { user: { id: 2 } }, { nowSec: NOW })), "VIEW_TOKEN_USER");
});
runTest("öffentlich ausgestelltes Token gilt nicht für angemeldeten Nutzer", () => {
  const t = issueViewToken({ ...claims, u: 0 }, KEY, 3600, NOW);
  assert.strictEqual(codeOf(() => verifyViewToken(t, KEY, req1, { nowSec: NOW })), "VIEW_TOKEN_USER");
  assert.ok(verifyViewToken(t, KEY, {}, { nowSec: NOW }));
});
runTest("Müll / leer / zu lang → INVALID", () => {
  for (const t of ["", "abc", ".", "a.b", "x".repeat(5000) + ".y"]) {
    assert.strictEqual(codeOf(() => verifyViewToken(t, KEY, req1, { nowSec: NOW })), "VIEW_TOKEN_INVALID", t.slice(0, 10));
  }
});
runTest("Mindestlaufzeit 60 s", () => {
  const t = issueViewToken(claims, KEY, 0, NOW);
  assert.ok(verifyViewToken(t, KEY, req1, { nowSec: NOW + 59 }));
});
runTest("zu kurzes Geheimnis wird abgelehnt", () => assert.throws(() => deriveKey("kurz", "public")));
runTest("userIdOf: anonym → 0", () => {
  assert.strictEqual(userIdOf({}), 0);
  assert.strictEqual(userIdOf({ user: { id: 7 } }), "7");
});

// ==== Bereich =================================================================
runTest("isWithinRoot: Wurzel selbst", () => assert.ok(isWithinRoot("kunden/42", "kunden/42")));
runTest("isWithinRoot: Unterordner", () => assert.ok(isWithinRoot("kunden/42/rechnungen/a.pdf", "kunden/42")));
runTest("isWithinRoot: Präfix ohne Segmentgrenze (kunden/420)", () => assert.ok(!isWithinRoot("kunden/420", "kunden/42")));
runTest("isWithinRoot: Elternordner", () => assert.ok(!isWithinRoot("kunden", "kunden/42")));
runTest("isWithinRoot: Geschwister", () => assert.ok(!isWithinRoot("kunden/43/x", "kunden/42")));
runTest("isWithinRoot: leere Wurzel = ganze Verbindung", () => assert.ok(isWithinRoot("a/b", "")));
runTest("needsRenewal: frisch nein, halb abgelaufen ja", () => {
  assert.strictEqual(needsRenewal({ e: NOW + 3600 }, 3600, NOW), false);
  assert.strictEqual(needsRenewal({ e: NOW + 1000 }, 3600, NOW), true);
});

// ==== Bindung / Konfiguration ===============================================
const basePerms = { canRead: true, canWrite: true, allowUpload: true, allowDelete: true, allowRename: true, allowMkdir: true };
runTest("restrict: Read-only-View nimmt alle Schreibrechte", () => {
  const p = restrictPermissions(basePerms, { w: false, h: false, l: false, r: "x" });
  assert.deepStrictEqual(
    [p.canWrite, p.allowUpload, p.allowDelete, p.allowRename, p.allowMkdir],
    [false, false, false, false, false]
  );
  assert.strictEqual(p.root, "x");
});
runTest("restrict: View darf nie MEHR als die Verbindung", () => {
  const p = restrictPermissions({ ...basePerms, canWrite: false, allowUpload: false }, { w: true });
  assert.strictEqual(p.canWrite, false);
  assert.strictEqual(p.allowUpload, false);
});
runTest("restrict: ohne Token unverändert", () => assert.strictEqual(restrictPermissions(basePerms, null), basePerms));
runTest("bindingMode: Standard required", () => {
  assert.strictEqual(bindingMode({}), "required");
  assert.strictEqual(bindingMode({ view_binding: "optional" }), "optional");
  assert.strictEqual(bindingMode({ view_binding: "quatsch" }), "required");
});
runTest("TTL: Standard 12 h, Grenzen 1–168 h", () => {
  assert.strictEqual(tokenTtlSec({}), 12 * 3600);
  assert.strictEqual(tokenTtlSec({ view_token_ttl_hours: 0.1 }), 3600);
  assert.strictEqual(tokenTtlSec({ view_token_ttl_hours: 9999 }), 168 * 3600);
});
runTest("tokenFromRequest: Header vor Body vor Query", () => {
  assert.strictEqual(tokenFromRequest({ headers: { "x-samba-view-token": "H" }, body: { vt: "B" }, query: { vt: "Q" } }), "H");
  assert.strictEqual(tokenFromRequest({ headers: {}, body: { vt: "B" }, query: { vt: "Q" } }), "B");
  assert.strictEqual(tokenFromRequest({ headers: {}, query: { vt: "Q" } }), "Q");
  assert.strictEqual(tokenFromRequest({ headers: {} }), "");
});

// ==== Zeilen & Startpfad (fail closed) ======================================
runTest("assertRowPath: from_field ohne Zeile wirft", () =>
  assert.throws(() => assertRowPath({ mode: "from_field", path_field: "ordner" }, null)));
runTest("assertRowPath: leerer Feldwert wirft", () =>
  assert.throws(() => assertRowPath({ mode: "from_field", path_field: "ordner" }, { ordner: " " })));
runTest("assertRowPath: static ohne Zeile ok", () => assertRowPath({ mode: "static" }, null));
/** Eigene Fake-Tabelle pro Test – die async-Tests laufen parallel. */
const makeTable = () => ({
  pk_name: "id",
  fields: [{ name: "id" }, { name: "ordner" }],
  calls: [],
  async getRow(where, opts) { this.calls.push({ where, opts }); return { id: 1, ordner: "a" }; },
});
runTest("loadRowForView: nur bekannte Spalten, mit forUser", async () => {
  const fakeTable = makeTable();
  await loadRowForView(fakeTable, { id: "1", evil: "x" }, req1);
  assert.deepStrictEqual(fakeTable.calls[0].where, { id: "1" });
  assert.strictEqual(fakeTable.calls[0].opts.forUser, req1.user);
});
runTest("loadRowForView: kein passender Schlüssel → null (nicht erste Zeile)", async () => {
  const fakeTable = makeTable();
  assert.strictEqual(await loadRowForView(fakeTable, { evil: "x" }, req1), null);
  assert.strictEqual(fakeTable.calls.length, 0);
});
runTest("loadRowForView: anonym → forPublic", async () => {
  const fakeTable = makeTable();
  await loadRowForView(fakeTable, { id: 1 }, {});
  assert.strictEqual(fakeTable.calls[0].opts.forPublic, true);
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log("\nall view-token tests passed");
});
