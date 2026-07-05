/**
 * Minimal sanity tests for the path sanitizer. Runs without any test
 * framework – just `node test/sanitize.test.js` (exit code 0 = success).
 *
 * These are the security-critical assertions of the plugin: every path
 * coming from the browser is fed through `sanitizeRelativePath` before it
 * ever touches the SMB client.
 */

"use strict";

const assert = require("assert");
const {
  sanitizeRelativePath,
  toSmbPath,
  toSmbUrl,
} = require("../smb-client");

let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log("ok  " + name);
  } catch (e) {
    failed++;
    console.error("FAIL " + name + " – " + (e.message || e));
  }
}

// --- accepted inputs --------------------------------------------------------
t("empty string → empty", () => assert.strictEqual(sanitizeRelativePath(""), ""));
t("undefined → empty", () => assert.strictEqual(sanitizeRelativePath(undefined), ""));
t("single slash → empty", () => assert.strictEqual(sanitizeRelativePath("/"), ""));
t("simple path", () => assert.strictEqual(sanitizeRelativePath("foo/bar"), "foo/bar"));
t("double slashes collapse", () =>
  assert.strictEqual(sanitizeRelativePath("foo//bar"), "foo/bar"));
t("backslashes normalise", () =>
  assert.strictEqual(sanitizeRelativePath("foo\\bar\\baz"), "foo/bar/baz"));
t("leading ./ stripped", () =>
  assert.strictEqual(sanitizeRelativePath("./foo"), "foo"));
t("mid ./ stripped", () =>
  assert.strictEqual(sanitizeRelativePath("foo/./bar"), "foo/bar"));
t("unicode allowed", () =>
  assert.strictEqual(sanitizeRelativePath("küchë/rechnung.pdf"), "küchë/rechnung.pdf"));
t("spaces allowed", () =>
  assert.strictEqual(sanitizeRelativePath("Kunde 42/Akte 2026.pdf"), "Kunde 42/Akte 2026.pdf"));

// --- rejected inputs --------------------------------------------------------
const rejects = [
  ["..", "traversal"],
  ["../etc/passwd", "traversal"],
  ["foo/../../etc", "traversal"],
  ["foo/..", "traversal"],
  ["/etc/../root", "traversal"],
  ["C:/x", "drive letter"],
  ["d:\\Windows", "drive letter"],
  ["//srv/share", "UNC"],
  ["\\\\srv\\share", "UNC"],
  ["\0nul", "NUL byte"],
  ["ok\0inside", "NUL byte"],
];
for (const [inp, label] of rejects) {
  t("rejects " + label + ": " + JSON.stringify(inp), () => {
    assert.throws(() => sanitizeRelativePath(inp));
  });
}

t("too long rejected", () => {
  const s = "a".repeat(5000);
  assert.throws(() => sanitizeRelativePath(s));
});

// --- helpers ---------------------------------------------------------------
t("toSmbPath converts", () =>
  assert.strictEqual(toSmbPath("a/b/c"), "a\\b\\c"));

t("toSmbUrl encodes", () => {
  const url = toSmbUrl(
    { server: "srv", share: "docs", base_path: "proj" },
    "kunde 42/akte.pdf"
  );
  assert.strictEqual(url, "smb://srv/docs/proj/kunde%2042/akte.pdf");
});

if (failed) {
  console.error("\n" + failed + " test(s) failed");
  process.exit(1);
} else {
  console.log("\nAll tests passed");
}
