/**
 * saltcorn-samba – Gemeinsame Client-Utilities für den Browser.
 *
 * Wird von samba-filemanager.js und samba-tree.js benutzt. Enthält:
 *   - iconFor(item)             : Emoji-Icon für Verzeichnisse/Dateien
 *                                 (früher in beiden JS-Dateien dupliziert)
 *   - extOf(name)               : Extension in lower-case, ohne Punkt
 *   - joinPath(a, b), parentOf  : simple posix-artige Pfad-Helfer
 *   - fmtSize(bytes), fmtDate(v): menschenlesbare Formatierung
 *   - isViewable(name)          : PDFs, Bilder, Text-artige Dateien
 *   - mediaTypeFor(item)        : grober MIME-Typ (auch nur für File-Manager)
 *   - t(key, params)            : i18n-Übersetzung. Katalog wird nach dem
 *                                 Laden asynchron nachgeschoben; solange nur
 *                                 der Key nicht auffindbar ist, gilt der Key
 *                                 selbst als Rückfalltext.
 *   - setCatalog(obj)           : setzt den i18n-Katalog (aus dem Server-JSON)
 *   - loadCatalog(url)          : lädt einen JSON-Katalog per fetch()
 *
 * Alles wird an `window.SambaCommon` gehängt. Die Datei ist absichtlich in
 * ES5 gehalten (kein Bundler-Zwang, funktioniert in älteren Browsern).
 */
(function () {
  "use strict";

  // ---- i18n-State ---------------------------------------------------------
  var catalog = {};

  function setCatalog(obj) {
    catalog = obj && typeof obj === "object" ? obj : {};
  }

  /** Löst {name}-Platzhalter im Muster auf. */
  function interpolate(msg, params) {
    if (!params) return msg;
    return String(msg).replace(/\{(\w+)\}/g, function (_, k) {
      return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : "";
    });
  }

  /** Übersetzt einen Key. Fällt auf den Key selbst zurück, falls kein Eintrag. */
  function t(key, params) {
    if (Object.prototype.hasOwnProperty.call(catalog, key)) {
      return interpolate(catalog[key], params);
    }
    return interpolate(key, params);
  }

  /**
   * Lädt den Katalog von der übergebenen URL (z. B. /samba-i18n.json?locale=de).
   * Ergebnis wird gecacht; scheitert der Fetch, bleibt der aktuelle Katalog stehen.
   */
  function loadCatalog(url) {
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) { setCatalog(data); return data; })
      .catch(function () { return {}; });
  }

  // ---- reine Utilities ---------------------------------------------------
  /** Extension in lower-case, ohne führenden Punkt. */
  function extOf(name) {
    var s = String(name || "");
    var dot = s.lastIndexOf(".");
    return dot >= 0 ? s.slice(dot + 1).toLowerCase() : "";
  }

  /**
   * Einheitliches Icon für Verzeichnisse und Dateien.
   * Die Kategorien decken die häufigsten Office-, Bild-, Archiv-, Audio- und
   * Video-Formate ab. Alles Unbekannte bekommt 📎.
   */
  function iconFor(item) {
    if (item && item.isDir) return "📁";
    var e = extOf(item && item.name);
    if (e === "pdf") return "📄";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].indexOf(e) >= 0) return "🖼️";
    if (["doc", "docx", "odt", "rtf", "txt", "md"].indexOf(e) >= 0) return "📝";
    if (["xls", "xlsx", "ods", "csv"].indexOf(e) >= 0) return "📊";
    if (["ppt", "pptx", "odp"].indexOf(e) >= 0) return "📽️";
    if (["zip", "tar", "gz", "7z", "rar"].indexOf(e) >= 0) return "🗜️";
    if (["mp3", "wav", "ogg", "flac", "m4a"].indexOf(e) >= 0) return "🎵";
    if (["mp4", "mkv", "mov", "avi", "webm"].indexOf(e) >= 0) return "🎬";
    return "📎";
  }

  /** Erlaubt inline-Anzeige im integrierten Viewer (PDF, Bilder, Text). */
  function isViewable(name) {
    var n = String(name || "").toLowerCase();
    return (
      n.endsWith(".pdf") ||
      /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n) ||
      /\.(txt|md|json|xml|csv|html?)$/.test(n)
    );
  }

  /**
   * Grober MIME-Typ nur anhand der Extension – ausreichend zum Sortieren und
   * für die "Media type"-Spalte. Der Server liefert für den echten Stream
   * seinen eigenen (genaueren) Content-Type.
   */
  function mediaTypeFor(item) {
    if (item && item.isDir) return "folder";
    var e = extOf(item && item.name);
    var map = {
      pdf: "application/pdf",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
      txt: "text/plain", md: "text/markdown", csv: "text/csv",
      json: "application/json", xml: "application/xml",
      html: "text/html", htm: "text/html",
      zip: "application/zip", doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      mp3: "audio/mpeg", mp4: "video/mp4", mkv: "video/x-matroska",
      mov: "video/quicktime", avi: "video/x-msvideo",
    };
    return map[e] || (e ? "application/" + e : "application/octet-stream");
  }

  /** Größe in KiB/MiB/GiB. Kompakter Format-String für Tabellen und Bäume. */
  function fmtSize(n) {
    if (!n || n < 0) return "";
    if (n < 1024) return n + " B";
    var kib = n / 1024;
    if (kib < 1024) return kib.toFixed(kib < 10 ? 1 : 0) + " KiB";
    var mib = kib / 1024;
    if (mib < 1024) return mib.toFixed(mib < 10 ? 1 : 0) + " MiB";
    return (mib / 1024).toFixed(2) + " GiB";
  }

  /** ISO-artig, ohne Sekunden ("2026-07-08 22:31"). Leere/ungültige Werte → "". */
  function fmtDate(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var pad = function (x) { return String(x).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /** Fügt zwei Pfad-Fragmente mit genau einem "/" zusammen. */
  function joinPath(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (a.replace(/\/+$/, "") + "/" + b.replace(/^\/+/, "")).replace(/\/+/g, "/");
  }

  /** Übergeordneter Pfad. `parentOf("a/b/c")` = "a/b", `parentOf("a")` = "". */
  function parentOf(p) {
    if (!p) return "";
    var i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  }

  // ---- Export -------------------------------------------------------------
  window.SambaCommon = {
    // i18n
    t: t,
    setCatalog: setCatalog,
    loadCatalog: loadCatalog,
    // icons / classification
    iconFor: iconFor,
    isViewable: isViewable,
    mediaTypeFor: mediaTypeFor,
    // strings & paths
    extOf: extOf,
    fmtSize: fmtSize,
    fmtDate: fmtDate,
    joinPath: joinPath,
    parentOf: parentOf,
  };
})();
