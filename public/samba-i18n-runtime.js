/**
 * saltcorn-samba – Gemeinsamer i18n-Kern.
 *
 * Reiner, dependencyfreier Übersetzungs-Kern, den *sowohl* die Server-Seite
 * (i18n.js) als auch die Browser-Seite (public/samba-common.js) benutzen.
 * Verhindert, dass `interpolate()` und die Katalog-Lookup-Logik in zwei
 * Dateien parallel gepflegt werden müssen.
 *
 * Duales Modul-Format:
 *   - Node/CommonJS:  `const rt = require("./i18n-runtime");`
 *   - Browser:        das gleiche File wird als <script> geladen und exportiert
 *                     nach `window.SambaI18nRuntime`.
 *
 * Die Datei ist absichtlich in ES5 gehalten (keine let/const, kein
 * arrow-Function, kein Optional Chaining) – so bleibt sie ohne Transpiler in
 * jeder Node- und Browser-Umgebung lauffähig.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && typeof module.exports === "object") {
    module.exports = api;                 // Node/CommonJS
  } else if (root) {
    root.SambaI18nRuntime = api;          // Browser (window.SambaI18nRuntime)
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Ersetzt {name}-Platzhalter im Muster durch die passenden Werte aus
   * `params`. Fehlt ein Wert, wird der Platzhalter zu leerem String.
   *
   * Bewusst tolerant: `null`/`undefined` als params sind erlaubt und
   * geben das Muster unverändert zurück.
   */
  function interpolate(msg, params) {
    if (params == null) return msg;
    return String(msg).replace(/\{(\w+)\}/g, function (_, key) {
      return Object.prototype.hasOwnProperty.call(params, key)
        ? String(params[key])
        : "";
    });
  }

  /**
   * Schlägt einen Übersetzungs-Key in einer geordneten Liste von Katalogen
   * nach und interpoliert die Platzhalter. Der erste Katalog, der den Key
   * kennt, gewinnt. Findet keiner den Key, wird der Key selbst als
   * Fallback-Text interpoliert und zurückgegeben – so bricht die UI nie.
   *
   *   translate("fm.upload.button", { locale: "de" }, [deCatalog, enCatalog])
   *
   * @param {string}   key       Übersetzungs-Key.
   * @param {object=}  params    Optionale Placeholder-Werte.
   * @param {Array<object>} catalogs Priorisierte Liste von Katalogen (Objekt
   *                                 mit `key -> String`). `null`-Einträge
   *                                 werden übersprungen.
   */
  function translate(key, params, catalogs) {
    if (catalogs && catalogs.length) {
      for (var i = 0; i < catalogs.length; i++) {
        var cat = catalogs[i];
        if (cat && Object.prototype.hasOwnProperty.call(cat, key)) {
          return interpolate(cat[key], params);
        }
      }
    }
    return interpolate(key, params);
  }

  return { interpolate: interpolate, translate: translate };
});
