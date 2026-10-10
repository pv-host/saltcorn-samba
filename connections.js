/**
 * saltcorn-samba – Verbindungsregister (ab v0.5.0).
 *
 * Eine Saltcorn-Instanz kann mehrere SMB-Verbindungen (Server + Freigabe +
 * Zugangsdaten) gleichzeitig nutzen. Jede Verbindung hat eine eindeutige
 * Kennung (`name`), über die Views und HTTP-Routen sie referenzieren.
 *
 *   - Die bisherigen Felder der Plugin-Konfiguration (server, share, …)
 *     bilden die Verbindung mit der Kennung "default". Bestehende
 *     Installationen laufen dadurch ohne Migration weiter.
 *   - Weitere Verbindungen liegen im Konfigurationsfeld `connections`
 *     (Saltcorn-FieldRepeat → Array von Objekten).
 *
 * Globale Einstellungen (allow_upload, max_upload_mb, denied_extensions,
 * min_role_read, min_role_write, …) gelten für alle Verbindungen. Pro
 * Verbindung können überschrieben werden:
 *   - min_role_read / min_role_write (nur leer = globaler Wert)
 *   - read_only (sperrt sämtliche Schreibaktionen für diese Verbindung)
 *
 * Sicherheitsmodell: Die Kennung kommt bei jedem Request vom Browser
 * (?conn=…). Sie ist daher KEINE Sicherheitsgrenze für sich – geschützt
 * wird über die pro Verbindung prüfbaren Rollen und die Rechte des
 * jeweiligen SMB-Service-Accounts. Zugangsdaten verlassen den Server nie.
 *
 * Dieses Modul hat keine Saltcorn-Abhängigkeiten und ist vollständig
 * unit-getestet (test/connections.test.js).
 */

"use strict";

const DEFAULT_CONNECTION = "default";

/** Felder, die eine Verbindung beschreiben (Rest ist globale Konfiguration). */
const CONNECTION_KEYS = [
  "server",
  "port",
  "share",
  "domain",
  "username",
  "password",
  "base_path",
  "public_smb_host",
  "signing_mode",
  "encryption_mode",
];

/** Optionale, pro Verbindung überschreibbare Rechte-Felder. */
const OVERRIDE_KEYS = ["min_role_read", "min_role_write"];

/** Kennung: Buchstabe/Ziffer, danach Buchstaben, Ziffern, _ - . (max. 40). */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

/** Fehler mit HTTP-Status, damit Routen ihn direkt durchreichen können. */
function connectionError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Saltcorn liefert Bool-Werte normalerweise als true/false. Ältere
 * Formulare bzw. manuell gepflegte Konfigurationen können aber auch
 * "on", "true", "1" enthalten. Alles andere (inkl. undefined) ist false.
 *
 * Wichtig: Dieselbe Funktion entscheidet über die Sichtbarkeit der Buttons
 * (/sambadir → perms) UND über die Freigabe der Schreibrouten. Bis v0.4.16
 * wurde dafür an zwei Stellen unterschiedlich geprüft (`!== false` vs.
 * Truthiness) – Ursache für „Button sichtbar, Aktion schlägt mit 403 fehl“.
 */
function isEnabled(value) {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return ["on", "true", "1", "yes", "ja"].includes(value.trim().toLowerCase());
  }
  return false;
}

/** Normalisiert und prüft eine Verbindungs-Kennung. Leer → "default". */
function normaliseConnectionName(raw) {
  if (raw === undefined || raw === null) return DEFAULT_CONNECTION;
  const name = String(raw).trim();
  if (!name) return DEFAULT_CONNECTION;
  if (!NAME_RE.test(name)) {
    throw connectionError(
      400,
      "Ungültige Verbindungs-Kennung „" + name.slice(0, 60) + "“ " +
        "(erlaubt: Buchstaben, Ziffern, _ - ., max. 40 Zeichen)",
      "BAD_CONNECTION_NAME"
    );
  }
  return name;
}

/** Leerer String / null / undefined → undefined, sonst Zahl (oder undefined). */
function optionalNumber(v) {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Kopiert nur die Verbindungsfelder aus `src`. */
function pickConnectionFields(src) {
  const out = {};
  for (const k of CONNECTION_KEYS) {
    if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  }
  return out;
}

/**
 * Liefert die zusätzlichen Verbindungen aus der Plugin-Konfiguration als
 * Array. Saltcorn speichert FieldRepeat-Werte als Array von Objekten;
 * manuell gepflegte Konfigurationen können auch ein JSON-String sein.
 */
function rawExtraConnections(pluginCfg) {
  let list = pluginCfg && pluginCfg.connections;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch (_) {
      list = [];
    }
  }
  return Array.isArray(list) ? list.filter((c) => c && typeof c === "object") : [];
}

/**
 * Baut die vollständige Liste aller Verbindungen. Jede Verbindung ist ein
 * flaches Objekt, das sich direkt an withClient()/canRead()/canWrite()
 * übergeben lässt (globale Einstellungen + Verbindungsfelder + Overrides).
 *
 * Ungültige Einträge (fehlende/ungültige/doppelte Kennung, kein Server
 * oder Share) werden nicht verwendet, sondern in `problems` gemeldet –
 * damit ein Tippfehler in einer Zusatzverbindung nie die Standard-
 * verbindung lahmlegt.
 *
 * @returns {{ connections: object[], problems: string[] }}
 */
function buildConnections(pluginCfg) {
  const cfg = pluginCfg || {};
  const globals = { ...cfg };
  delete globals.connections;
  for (const k of CONNECTION_KEYS) delete globals[k];

  const connections = [];
  const problems = [];
  const seen = new Set();

  // 1. Standardverbindung aus den klassischen Feldern (rückwärtskompatibel).
  if (cfg.server && cfg.share) {
    connections.push({
      ...globals,
      ...pickConnectionFields(cfg),
      name: DEFAULT_CONNECTION,
      label: String(cfg.default_label || "").trim() || "Standard",
      read_only: false,
    });
    seen.add(DEFAULT_CONNECTION.toLowerCase());
  }

  // 2. Zusätzliche Verbindungen.
  rawExtraConnections(cfg).forEach((entry, index) => {
    const pos = "Zusatzverbindung #" + (index + 1);
    let name;
    try {
      name = normaliseConnectionName(entry.name);
    } catch (e) {
      problems.push(pos + ": " + e.message);
      return;
    }
    if (!entry.name || name === DEFAULT_CONNECTION) {
      problems.push(pos + ": Kennung fehlt oder ist reserviert („default“).");
      return;
    }
    if (seen.has(name.toLowerCase())) {
      problems.push(pos + ": Kennung „" + name + "“ ist doppelt vergeben.");
      return;
    }
    if (!entry.server || !entry.share) {
      problems.push(pos + " („" + name + "“): Server und Freigabe sind Pflicht.");
      return;
    }
    seen.add(name.toLowerCase());

    const conn = {
      ...globals,
      ...pickConnectionFields(entry),
      name,
      label: String(entry.label || "").trim() || name,
      read_only: isEnabled(entry.read_only),
    };
    if (!conn.domain) conn.domain = "WORKGROUP";
    for (const k of OVERRIDE_KEYS) {
      const n = optionalNumber(entry[k]);
      if (n !== undefined) conn[k] = n;
    }
    connections.push(conn);
  });

  return { connections, problems };
}

/** Alle gültigen Verbindungen (Kurzform von buildConnections). */
function listConnections(pluginCfg) {
  return buildConnections(pluginCfg).connections;
}

/**
 * Löst eine Kennung zur effektiven Verbindungskonfiguration auf.
 * Wirft mit `status` 400 (ungültige Kennung), 404 (unbekannt) oder 500
 * (Plugin gar nicht konfiguriert).
 */
function resolveConnection(pluginCfg, requestedName) {
  const name = normaliseConnectionName(requestedName);
  const { connections } = buildConnections(pluginCfg);
  if (!connections.length) {
    throw connectionError(500, "Samba-Plugin ist nicht konfiguriert (keine Verbindung angelegt).", "NOT_CONFIGURED");
  }
  const lc = name.toLowerCase();
  const found = connections.find((c) => c.name.toLowerCase() === lc);
  if (!found) {
    throw connectionError(404, "Unbekannte Samba-Verbindung „" + name + "“.", "UNKNOWN_CONNECTION");
  }
  return found;
}

/**
 * Optionen für das Dropdown in der View-Konfiguration. Die Standard-
 * verbindung steht immer an erster Stelle – auch wenn sie (noch) nicht
 * konfiguriert ist, damit bestehende Views ihren Wert behalten.
 */
function connectionOptions(pluginCfg) {
  const names = listConnections(pluginCfg).map((c) => c.name);
  if (!names.includes(DEFAULT_CONNECTION)) names.unshift(DEFAULT_CONNECTION);
  return names;
}

// ---------------------------------------------------------------------------
// Rollen / Rechte – arbeiten auf einer AUFGELÖSTEN Verbindung
// ---------------------------------------------------------------------------

/** Saltcorn-Rolle des Requests (1 = Admin … 100 = Public). */
function roleOf(req) {
  const u =
    (req && req.user) ||
    (req && req.session && req.session.passport && req.session.passport.user) ||
    null;
  if (!u) return 100;
  const rid = u.role_id !== undefined ? u.role_id : u.roleId;
  const n = Number(rid);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

function canRead(req, conn) {
  const min = optionalNumber(conn && conn.min_role_read);
  return roleOf(req) <= (min === undefined ? 80 : min);
}

function canWrite(req, conn) {
  if (!conn || conn.read_only) return false;
  const min = optionalNumber(conn.min_role_write);
  const limit = min === undefined ? 40 : min;
  // 100 deaktiviert Schreibzugriffe explizit komplett.
  if (limit >= 100) return false;
  return roleOf(req) <= limit;
}

/**
 * Effektive Berechtigungen eines Requests auf einer Verbindung – die
 * EINZIGE Quelle sowohl für die Button-Sichtbarkeit im Browser als auch
 * für die Prüfung in den Schreibrouten.
 */
function permissionsFor(req, conn) {
  const write = canWrite(req, conn);
  return {
    canRead: canRead(req, conn),
    canWrite: write,
    allowUpload: write && isEnabled(conn.allow_upload),
    allowDelete: write && isEnabled(conn.allow_delete),
    allowRename: write && isEnabled(conn.allow_rename),
    allowMkdir: write && isEnabled(conn.allow_mkdir),
    maxUploadMb: Number(conn.max_upload_mb) || 50,
    readOnly: !!conn.read_only,
  };
}

module.exports = {
  DEFAULT_CONNECTION,
  CONNECTION_KEYS,
  isEnabled,
  normaliseConnectionName,
  buildConnections,
  listConnections,
  resolveConnection,
  connectionOptions,
  roleOf,
  canRead,
  canWrite,
  permissionsFor,
};
