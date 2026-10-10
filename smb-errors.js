/**
 * saltcorn-samba – SMB-Fehler in verständliche Meldungen übersetzen.
 *
 * smb3-client meldet Fehler als „CREATE failed: STATUS_ACCESS_DENIED“ o. ä.
 * Für Endnutzer ist das kaum verwertbar. `explainSmbError()` erkennt die
 * häufigsten NTSTATUS-Codes und liefert eine deutsche Erklärung; die
 * Original-Antwort des Servers bleibt in Klammern erhalten, damit Admins
 * weiterhin gezielt suchen können.
 */

"use strict";

const RULES = [
  {
    re: /ACCESS_DENIED|0xC0000022|EACCES/i,
    msg: (ctx) =>
      "Zugriff verweigert – der SMB-Benutzer „" + (ctx.username || "(anonym)") +
      "“ hat auf dem Fileserver keine Schreib-/Leserechte für diesen Ordner " +
      "(Freigabe-ACL bzw. „read only = yes“ in smb.conf prüfen).",
  },
  {
    re: /OBJECT_NAME_COLLISION|0xC0000035|EEXIST/i,
    msg: () => "Ein Eintrag mit diesem Namen existiert bereits.",
  },
  {
    re: /OBJECT_PATH_NOT_FOUND|0xC000003A/i,
    msg: () => "Der übergeordnete Ordner existiert nicht (mehr).",
  },
  {
    re: /OBJECT_NAME_NOT_FOUND|0xC0000034|ENOENT|NO_SUCH_FILE/i,
    msg: () => "Datei oder Ordner wurde auf der Freigabe nicht gefunden.",
  },
  {
    re: /DIRECTORY_NOT_EMPTY|0xC0000101|ENOTEMPTY/i,
    msg: () => "Der Ordner ist nicht leer und kann daher nicht gelöscht werden.",
  },
  {
    re: /SHARING_VIOLATION|0xC0000043|EBUSY/i,
    msg: () => "Die Datei ist gerade von einem anderen Programm geöffnet.",
  },
  {
    re: /DISK_FULL|0xC000007F|QUOTA_EXCEEDED|0xC0000044|ENOSPC/i,
    msg: () => "Kein Speicherplatz mehr frei bzw. Quota auf dem Fileserver überschritten.",
  },
  {
    re: /MEDIA_WRITE_PROTECTED|0xC00000A2|EROFS/i,
    msg: () => "Die Freigabe ist schreibgeschützt.",
  },
  {
    re: /OBJECT_NAME_INVALID|0xC0000033/i,
    msg: () => "Der Name enthält Zeichen, die der Fileserver nicht akzeptiert.",
  },
  {
    re: /LOGON_FAILURE|0xC000006D/i,
    msg: () => "Anmeldung am Fileserver fehlgeschlagen (Benutzer/Passwort/Domäne prüfen).",
  },
  {
    re: /BAD_NETWORK_NAME|0xC00000CC/i,
    msg: (ctx) => "Die Freigabe „" + (ctx.share || "?") + "“ existiert auf dem Server nicht.",
  },
  {
    re: /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN/i,
    msg: (ctx) => "Fileserver „" + (ctx.server || "?") + "“ ist nicht erreichbar.",
  },
];

/**
 * @param {Error|string} err  Fehler aus smb3-client / smb-client.js
 * @param {object} [ctx]      Verbindung (server, share, username) für die Meldung
 * @returns {string}
 */
function explainSmbError(err, ctx) {
  const raw = String((err && err.message) || err || "Unbekannter Fehler");
  const c = ctx || {};
  for (const rule of RULES) {
    if (rule.re.test(raw)) return rule.msg(c) + " (Server: " + raw + ")";
  }
  return raw;
}

module.exports = { explainSmbError };
