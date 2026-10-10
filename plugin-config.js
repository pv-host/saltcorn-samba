/**
 * saltcorn-samba – Zugriff auf die aktuelle Plugin-Konfiguration.
 *
 * Bis v0.4.16 wurde die Konfiguration über feste Schlüssel gesucht
 * ("saltcorn-samba@<version>", "saltcorn-samba", …). Saltcorn legt sie aber
 * unter dem *Installationsnamen* des Plugins ab – und der weicht z. B. bei
 * Installation aus Git oder einem lokalen Pfad ab. Dann lieferte das Plugin
 * still eine leere Konfiguration.
 *
 * Ab v0.5.0:
 *   1. Wir suchen in getState().plugins nach UNSEREM Manifest-Objekt und
 *      nehmen die Konfiguration unter genau diesem Namen (tenant-korrekt,
 *      weil getState() pro Tenant eine eigene State-Instanz liefert).
 *   2. Fallback: die bekannten Schlüssel wie bisher.
 *   3. Letzter Fallback: die Konfiguration, die Saltcorn beim Registrieren
 *      zuletzt an routes(cfg)/viewtemplates(cfg) übergeben hat.
 */

"use strict";

let manifestRef = null;
let lastRegisteredCfg = null;

function getStateSafe() {
  try {
    // Lazy require: vermeidet Zirkulär-Importe beim Plugin-Load und erlaubt
    // Unit-Tests ohne Saltcorn-Installation.
    const { getState } = require("@saltcorn/data/db/state");
    return getState();
  } catch (_) {
    return null;
  }
}

/** Wird von index.js mit dem exportierten Manifest aufgerufen. */
function registerManifest(manifest) {
  manifestRef = manifest;
}

/** Wird von index.js aufgerufen, wenn Saltcorn routes(cfg) o. ä. aufruft. */
function rememberConfig(cfg) {
  if (cfg && typeof cfg === "object") lastRegisteredCfg = cfg;
}

/** Liefert die Plugin-Konfiguration des aktuellen Tenants (nie null). */
function getPluginConfig() {
  const state = getStateSafe();
  const cfgs = (state && state.plugin_cfgs) || {};
  if (state && state.plugins && manifestRef) {
    for (const [name, plugin] of Object.entries(state.plugins)) {
      if (plugin === manifestRef && cfgs[name]) return cfgs[name];
    }
  }
  for (const key of Object.keys(cfgs)) {
    if (/^(@[^/]+\/)?saltcorn-samba(@.*)?$/.test(key)) return cfgs[key] || {};
  }
  return lastRegisteredCfg || {};
}

module.exports = { registerManifest, rememberConfig, getPluginConfig };
