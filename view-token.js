/**
 * saltcorn-samba – signierte View-Tokens (ab v0.6.0).
 *
 * Problem bis v0.5.0: Die Datei-Routen vertrauten den Parametern `conn` und
 * `path` aus dem Browser. Jeder Nutzer mit ausreichender Rolle konnte per
 * manipuliertem Request jede Verbindung und jeden Pfad (innerhalb des
 * Basispfads der Verbindung) ansprechen – unabhängig davon, welche View er
 * tatsächlich sehen darf.
 *
 * Lösung: Beim Rendern einer View stellt der Server ein HMAC-signiertes
 * Token aus, das den Zugriff an GENAU diese View-Instanz bindet:
 *
 *   c  Verbindungs-Kennung
 *   r  Wurzelpfad der View (view_base_path + Datensatz-Pfad + Unterpfad)
 *   w  Schreibaktionen in dieser View erlaubt
 *   h  versteckte Dateien anzeigen erlaubt
 *   l  smb://-Links erlaubt
 *   u  Saltcorn-User-ID (0 = nicht angemeldet) – Token ist nicht übertragbar
 *   vn Name der View (nur Diagnose/Logging)
 *   e  Ablaufzeitpunkt (Unix-Sekunden)
 *
 * Jede Route prüft Signatur, Ablauf, Benutzer und ob der angefragte Pfad
 * innerhalb von `r` liegt. Die Rollenprüfung pro Verbindung bleibt
 * zusätzlich bestehen (Rollenänderungen wirken sofort).
 *
 * Format: base64url(JSON-Claims) + "." + base64url(HMAC-SHA256)
 * Keine externe Abhängigkeit, kein Saltcorn-Import (unit-testbar).
 */

"use strict";

const crypto = require("crypto");

const TOKEN_VERSION = 1;
const KEY_LABEL = "saltcorn-samba/view-token/v" + TOKEN_VERSION;
const MAX_TOKEN_LENGTH = 4096;

/** Fehler mit HTTP-Status und maschinenlesbarem Code für den Browser. */
function tokenError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Leitet den Signaturschlüssel ab. `secret` ist das Basisgeheimnis (siehe
 * index.js: eigenes Plugin-Geheimnis oder Saltcorns session_secret),
 * `scope` trennt Mandanten (Tenant-Schema), damit ein Token aus Mandant A
 * in Mandant B nie gültig ist.
 */
function deriveKey(secret, scope) {
  if (!secret || String(secret).length < 8) {
    throw tokenError(500, "NO_SECRET", "Kein ausreichend langes Geheimnis für View-Tokens vorhanden.");
  }
  return crypto
    .createHmac("sha256", String(secret))
    .update(KEY_LABEL + "|" + String(scope || "public"))
    .digest();
}

/** Normalisiert die User-ID für den Vergleich (nicht angemeldet → 0). */
function userIdOf(req) {
  const u = (req && req.user) || null;
  const id = u && (u.id !== undefined ? u.id : u.user_id);
  return id === undefined || id === null || id === "" ? 0 : String(id);
}

/**
 * Stellt ein Token aus.
 * @param {object} claims  { c, r, w, h, l, u, vn }
 * @param {Buffer} key     Ergebnis von deriveKey()
 * @param {number} ttlSec  Gültigkeit in Sekunden
 * @param {number} [nowSec]
 */
function issueViewToken(claims, key, ttlSec, nowSec) {
  const now = nowSec !== undefined ? nowSec : Math.floor(Date.now() / 1000);
  const body = {
    v: TOKEN_VERSION,
    c: String(claims.c || "default"),
    r: String(claims.r || ""),
    w: !!claims.w,
    h: !!claims.h,
    l: !!claims.l,
    u: claims.u === undefined || claims.u === null ? 0 : String(claims.u),
    vn: claims.vn ? String(claims.vn).slice(0, 80) : undefined,
    e: now + Math.max(60, Number(ttlSec) || 0),
  };
  const payload = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac("sha256", key).update(payload).digest());
  return payload + "." + sig;
}

/**
 * Prüft ein Token und liefert die Claims. Wirft mit
 *   401 VIEW_TOKEN_INVALID  (Format/Signatur falsch, manipuliert)
 *   401 VIEW_TOKEN_EXPIRED  (abgelaufen – Seite neu laden)
 *   403 VIEW_TOKEN_USER     (Token gehört einem anderen Benutzer)
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowExpired] Für die Verlängerung: abgelaufene,
 *        aber korrekt signierte Tokens akzeptieren (nur bis `graceSec`).
 */
function verifyViewToken(token, key, req, opts) {
  const o = opts || {};
  const t = String(token || "");
  if (!t || t.length > MAX_TOKEN_LENGTH || t.indexOf(".") < 1) {
    throw tokenError(401, "VIEW_TOKEN_INVALID", "Ungültiges View-Token.");
  }
  const [payload, sig] = t.split(".", 2);
  const expected = crypto.createHmac("sha256", key).update(payload).digest();
  const given = fromB64url(sig);
  // Längenvergleich vorab, sonst wirft timingSafeEqual.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw tokenError(401, "VIEW_TOKEN_INVALID", "View-Token ungültig oder manipuliert.");
  }
  let claims;
  try {
    claims = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch (_) {
    throw tokenError(401, "VIEW_TOKEN_INVALID", "View-Token nicht lesbar.");
  }
  if (!claims || claims.v !== TOKEN_VERSION) {
    throw tokenError(401, "VIEW_TOKEN_INVALID", "View-Token-Version wird nicht unterstützt.");
  }
  const now = o.nowSec !== undefined ? o.nowSec : Math.floor(Date.now() / 1000);
  if (!(Number(claims.e) > now)) {
    throw tokenError(
      401,
      "VIEW_TOKEN_EXPIRED",
      "Die Ansicht ist abgelaufen. Bitte die Seite neu laden."
    );
  }
  if (String(claims.u) !== String(userIdOf(req))) {
    throw tokenError(403, "VIEW_TOKEN_USER", "Das View-Token gehört zu einem anderen Benutzer.");
  }
  return claims;
}

/**
 * Liegt `rel` innerhalb der View-Wurzel `root`? Beide Pfade müssen bereits
 * durch sanitizeRelativePath() normalisiert sein (keine "..", kein
 * führender "/"). Präfix-Vergleich NUR an Segmentgrenzen:
 * root "kunden/42" erlaubt "kunden/42/x", aber NICHT "kunden/420".
 */
function isWithinRoot(rel, root) {
  const r = String(root || "");
  const p = String(rel || "");
  if (!r) return true;
  return p === r || p.startsWith(r + "/");
}

/** Muss das Token verlängert werden (weniger als die Hälfte der Laufzeit übrig)? */
function needsRenewal(claims, ttlSec, nowSec) {
  const now = nowSec !== undefined ? nowSec : Math.floor(Date.now() / 1000);
  return Number(claims.e) - now < Math.max(60, Number(ttlSec) || 0) / 2;
}

module.exports = {
  TOKEN_VERSION,
  deriveKey,
  userIdOf,
  issueViewToken,
  verifyViewToken,
  isWithinRoot,
  needsRenewal,
};
