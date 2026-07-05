/**
 * Minimal sanity tests for the path & filename sanitizers.
 * Run with `node test/sanitize.test.js` (exit code 0 = success).
 */

"use strict";

const assert = require("assert");
const {
  sanitizeRelativePath,
  sanitizeFilename,
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

// ==== sanitizeRelativePath ==================================================
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

const relRejects = [
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
for (const [inp, label] of relRejects) {
  t("path rejects " + label + ": " + JSON.stringify(inp), () => {
    assert.throws(() => sanitizeRelativePath(inp));
  });
}

t("too long path rejected", () => {
  assert.throws(() => sanitizeRelativePath("a".repeat(5000)));
});

// ==== sanitizeFilename ======================================================
t("filename plain", () => assert.strictEqual(sanitizeFilename("hello.pdf"), "hello.pdf"));
t("filename with inner spaces", () =>
  assert.strictEqual(sanitizeFilename("invoice 2026.pdf"), "invoice 2026.pdf"));
t("filename unicode", () =>
  assert.strictEqual(sanitizeFilename("küche.jpg"), "küche.jpg"));

const filenameRejects = [
  ["", "empty"],
  ["   ", "whitespace only"],
  [".", "dot"],
  ["..", "dotdot"],
  ["a/b", "contains slash"],
  ["a\\b", "contains backslash"],
  ["with\0nul", "NUL byte"],
  ["ctrl\x1fchar", "control char"],
  ["quest?.txt", "question mark"],
  ['star*.txt', "star"],
  ['name"here.txt', "double quote"],
  ["pipe|name", "pipe"],
  ["colon:name", "colon"],
  ["angle<name>", "angle brackets"],
  ["ends.", "trailing dot"],
  ["ends ", "trailing space"],
  ["CON", "reserved device CON"],
  ["nul.txt", "reserved device NUL with ext"],
  ["COM1", "reserved device COM1"],
  ["a".repeat(300), "too long"],
];
for (const [inp, label] of filenameRejects) {
  t("filename rejects " + label + ": " + JSON.stringify(inp), () => {
    assert.throws(() => sanitizeFilename(inp));
  });
}

// ==== helpers ==============================================================
t("toSmbPath converts", () => assert.strictEqual(toSmbPath("a/b/c"), "a\\b\\c"));
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
