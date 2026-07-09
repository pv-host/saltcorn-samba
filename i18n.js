/**
 * saltcorn-samba – Minimales i18n-Modul (Server-Seite).
 *
 * Design-Ziele:
 *   - Keine externe Dependency (kein i18next, keine intl-messageformat).
 *   - JSON-Kataloge unter ./i18n/<locale>.json.
 *   - Lazy load + Cache; unbekannte Locales fallen automatisch auf `en`.
 *   - Placeholder-Syntax {name} wird durch die übergebenen Werte ersetzt.
 *
 * Locale-Auflösung (in dieser Reihenfolge):
 *   1. Explizit übergebener Wert (Request-Query ?locale=de).
 *   2. `req.getLocale()` (Saltcorn setzt das aus Cookie / Accept-Language).
 *   3. `req.headers["accept-language"]`  – erste passende Locale.
 *   4. Fallback = `en`.
 *
 * Die Client-Seite bekommt den passenden Katalog via Route
 *   GET /samba-i18n.json?locale=xx
 * (siehe index.js). Dort ruft samba-common.js `SambaCommon.setCatalog(...)` auf.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const CATALOG_DIR = path.join(__dirname, "i18n");
const DEFAULT_LOCALE = "en";
const catalogs = Object.create(null);       // locale -> { key: str }
const availableLocales = new Set(["de", "en"]);

/**
 * Load a catalogue from disk. Cached forever (plugin restart to reload).
 * Missing files silently return {} — the caller falls back to the key itself.
 */
function loadCatalog(locale) {
  if (catalogs[locale]) return catalogs[locale];
  const file = path.join(CATALOG_DIR, locale + ".json");
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    delete parsed.$meta;   // metadata is not a translation
    catalogs[locale] = parsed;
  } catch (_) {
    catalogs[locale] = {};
  }
  return catalogs[locale];
}

/**
 * Resolve a locale string to one we actually ship a catalogue for.
 * Accepts full IETF tags ("de-DE", "en-US") and language-only ("de", "en").
 */
function normaliseLocale(raw) {
  if (!raw) return DEFAULT_LOCALE;
  const lc = String(raw).toLowerCase().trim();
  if (availableLocales.has(lc)) return lc;
  const short = lc.split(/[-_]/)[0];
  if (availableLocales.has(short)) return short;
  return DEFAULT_LOCALE;
}

/**
 * Extract the caller's preferred locale from an Express-like request object.
 * Never throws; falls back to DEFAULT_LOCALE.
 */
function resolveLocaleFromReq(req, explicit) {
  if (explicit) return normaliseLocale(explicit);
  try {
    if (req) {
      // Saltcorn / i18next-express-middleware
      if (typeof req.getLocale === "function") {
        const l = req.getLocale();
        if (l) return normaliseLocale(l);
      }
      // Explicit query ?locale=de
      if (req.query && req.query.locale) {
        return normaliseLocale(req.query.locale);
      }
      // Accept-Language header – take the first tag we understand.
      const hdr = req.headers && req.headers["accept-language"];
      if (hdr) {
        const first = String(hdr).split(",")[0].split(";")[0];
        return normaliseLocale(first);
      }
    }
  } catch (_) {
    // fall through
  }
  return DEFAULT_LOCALE;
}

/**
 * Substitute {placeholder} tokens in the message. Missing values render as "".
 */
function interpolate(msg, params) {
  if (!params) return msg;
  return String(msg).replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : ""
  );
}

/**
 * Translate a single key. Falls back to English, then to the key itself so
 * a missing translation never breaks the UI.
 *
 *   t("fm.upload.button", { locale: "de" })                → "Hochladen"
 *   t("fm.deleted_ok", { locale: "de", name: "foo.txt" }) → "„foo.txt\" gelöscht"
 */
function t(key, params) {
  const opts = params || {};
  const locale = normaliseLocale(opts.locale);
  const primary = loadCatalog(locale);
  if (Object.prototype.hasOwnProperty.call(primary, key)) {
    return interpolate(primary[key], opts);
  }
  if (locale !== DEFAULT_LOCALE) {
    const fallback = loadCatalog(DEFAULT_LOCALE);
    if (Object.prototype.hasOwnProperty.call(fallback, key)) {
      return interpolate(fallback[key], opts);
    }
  }
  return key;
}

/**
 * Bind a locale so callers can write `const _ = tFor("de"); _("ui.close")`.
 */
function tFor(locale) {
  const loc = normaliseLocale(locale);
  return function boundTranslate(key, params) {
    return t(key, Object.assign({}, params || {}, { locale: loc }));
  };
}

/**
 * Return the raw catalogue for a locale, merged over the English defaults.
 * Used to ship a single JSON blob to the browser.
 */
function catalogFor(locale) {
  const loc = normaliseLocale(locale);
  const en = loadCatalog(DEFAULT_LOCALE);
  if (loc === DEFAULT_LOCALE) return Object.assign({}, en);
  const merged = Object.assign({}, en, loadCatalog(loc));
  return merged;
}

module.exports = {
  DEFAULT_LOCALE,
  availableLocales: Array.from(availableLocales),
  t,
  tFor,
  catalogFor,
  resolveLocaleFromReq,
  normaliseLocale,
};
