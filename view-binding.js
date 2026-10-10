/**
 * saltcorn-samba – View-Bindung: Saltcorn-spezifischer Teil (ab v0.6.0).
 *
 * view-token.js enthält die reine Kryptografie; dieses Modul liefert
 *   - den Signaturschlüssel (Plugin-Geheimnis oder Saltcorn-session_secret,
 *     pro Mandant abgeleitet),
 *   - die Konfiguration (Modus, Gültigkeitsdauer),
 *   - issueForView(): Token beim Rendern einer View ausstellen,
 *   - tokenFromRequest(): Token aus Header / Query / Body lesen,
 *   - restrictPermissions(): Rechte der Verbindung mit denen der View
 *     verknüpfen (UND).
 */

"use strict";

const crypto = require("crypto");
const { deriveKey, issueViewToken, userIdOf } = require("./view-token");

const HEADER = "x-samba-view-token";
const DEFAULT_TTL_HOURS = 12;

/** "required" (Standard) oder "optional" (Übergangsmodus, siehe README). */
function bindingMode(pluginCfg) {
  return pluginCfg && pluginCfg.view_binding === "optional" ? "optional" : "required";
}

/** Token-Gültigkeit in Sekunden (1 … 168 Stunden). */
function tokenTtlSec(pluginCfg) {
  const h = Number(pluginCfg && pluginCfg.view_token_ttl_hours);
  const hours = Number.isFinite(h) && h > 0 ? Math.min(168, Math.max(1, h)) : DEFAULT_TTL_HOURS;
  return Math.round(hours * 3600);
}

let processFallbackSecret = null;
let warnedFallback = false;

/**
 * Basisgeheimnis für die Schlüsselableitung:
 *   1. eigenes Plugin-Geheimnis (Konfiguration „Geheimnis für View-Tokens“) –
 *      nötig nur, wenn Saltcorn-Knoten unterschiedliche session_secrets haben;
 *   2. Saltcorns session_secret (signiert auch die Session-Cookies; alle
 *      Worker/Knoten einer Installation teilen es);
 *   3. Notlösung: Zufallswert pro Prozess (Warnung im Log; Tokens gelten
 *      dann nur im ausstellenden Prozess).
 */
function baseSecret(pluginCfg) {
  const own = pluginCfg && String(pluginCfg.view_token_secret || "").trim();
  if (own && own.length >= 16) return own;
  try {
    const db = require("@saltcorn/data/db");
    const s = db && db.connectObj && db.connectObj.session_secret;
    if (s && String(s).length >= 8) return String(s);
  } catch (_) {
    // ältere Saltcorn-Versionen / Tests ohne DB-Modul
  }
  if (!processFallbackSecret) processFallbackSecret = crypto.randomBytes(32).toString("hex");
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[saltcorn-samba] Kein session_secret gefunden – View-Tokens nutzen einen " +
        "zufälligen Schlüssel pro Prozess. Bitte in der Plugin-Konfiguration ein " +
        "„Geheimnis für View-Tokens“ (mind. 16 Zeichen) eintragen."
    );
  }
  return processFallbackSecret;
}

/** Mandanten-Kennung (Tenant-Schema), damit Tokens mandantengebunden sind. */
function tenantScope() {
  try {
    const db = require("@saltcorn/data/db");
    if (db && typeof db.getTenantSchema === "function") return db.getTenantSchema() || "public";
  } catch (_) {
    // keine DB → Einzelmandant
  }
  return "public";
}

/** Signaturschlüssel für den aktuellen Mandanten. */
function signingKey(pluginCfg) {
  return deriveKey(baseSecret(pluginCfg), tenantScope());
}

/**
 * Stellt beim Rendern einer View das Token aus.
 * @param {object} p
 * @param {object} p.pluginCfg
 * @param {object} p.req          Saltcorn-Request (für die User-ID)
 * @param {string} p.connection   Verbindungs-Kennung
 * @param {string} p.root         Wurzelpfad der View (bereits normalisiert)
 * @param {boolean} p.write       Schreibaktionen in dieser View erlaubt
 * @param {boolean} p.hidden      versteckte Dateien erlaubt
 * @param {boolean} p.smbLink     smb://-Links erlaubt
 * @param {string} [p.viewname]
 */
function issueForView(p) {
  const key = signingKey(p.pluginCfg);
  return issueViewToken(
    {
      c: p.connection,
      r: p.root,
      w: p.write,
      h: p.hidden,
      l: p.smbLink,
      u: userIdOf(p.req),
      vn: p.viewname,
    },
    key,
    tokenTtlSec(p.pluginCfg)
  );
}

/** Token aus Header (fetch), Body (Formulare) oder Query (Links/iframes). */
function tokenFromRequest(req) {
  const h = req && req.headers && req.headers[HEADER];
  if (h) return String(h);
  if (req && req.body && typeof req.body === "object" && req.body.vt) return String(req.body.vt);
  if (req && req.query && req.query.vt) return String(req.query.vt);
  return "";
}

/**
 * Verknüpft die Rechte der Verbindung (Rolle, read_only, allow_*) mit den
 * Rechten der View aus dem Token. Ohne Bindung (Modus „optional“ und kein
 * Token) bleiben die Verbindungsrechte unverändert.
 */
function restrictPermissions(perms, claims) {
  if (!claims) return perms;
  const write = perms.canWrite && !!claims.w;
  return {
    ...perms,
    canWrite: write,
    allowUpload: write && perms.allowUpload,
    allowDelete: write && perms.allowDelete,
    allowRename: write && perms.allowRename,
    allowMkdir: write && perms.allowMkdir,
    showHidden: !!claims.h,
    smbLink: !!claims.l,
    root: claims.r || "",
  };
}

module.exports = {
  HEADER,
  bindingMode,
  tokenTtlSec,
  signingKey,
  issueForView,
  tokenFromRequest,
  restrictPermissions,
};
