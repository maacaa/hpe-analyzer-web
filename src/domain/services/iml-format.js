// @ts-check
// Pure domain services for IML message formatting and date parsing.
// No I/O, no external data - safe for the innermost layer.

/** Parse "MM/DD/YYYY HH:MM:SS" into a Date (server local time). */
/**
 * @param {string} s
 * @returns {Date|null}
 */
export function parseLogDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, mi, ss] = m;
  return new Date(+yyyy, +mm - 1, +dd, +hh, +mi, +ss);
}

/** Message-based severity heuristics (fallback when the code is unknown). */
/**
 * @param {string} message
 * @returns {"critical"|"warning"|"information"}
 */
export function heuristicSeverity(message) {
  const m = message;
  // Explicit informational events (must come before generic "failure").
  if (/link failure/i.test(m)) return "information";
  if (/^firmware flashed\b/i.test(m) || /^firmware upgrade\b/i.test(m))
    return "information";
  // Critical hardware errors.
  if (/uncorrectable|machine check|bist.*failure|processor.*failure|\bcritical\b/i.test(m))
    return "critical";
  // Warnings / degraded conditions.
  if (/risk|degraded|mapped out|threshold exceeded|predictive|not redundant|input power loss/i.test(m))
    return "warning";
  return "information";
}

/** Split an IML message into alarm + resolution (HPE "ACTION:" text). */
/**
 * @param {string} message
 * @returns {{alarm:string, resolution:string|null}}
 */
export function splitAction(message) {
  const idx = message.indexOf("ACTION:");
  if (idx < 0) return { alarm: message, resolution: null };
  return {
    alarm: message.slice(0, idx).trim(),
    resolution: message.slice(idx + "ACTION:".length).trim(),
  };
}

/** Build the official documentation URL for an IML event. */
/**
 * @param {number} classCode
 * @param {number} eventCode
 * @returns {string}
 */
export function imlDocUrl(classCode, eventCode) {
  const cls = classCode.toString(16).padStart(4, "0");
  const ev = eventCode.toString(16).padStart(4, "0");
  return (
    "https://support.hpe.com/hpesc/public/docDisplay?docId=ilogen12-msg-en_us" +
    `&docLocale=en_US&page=class0x${cls}code0x${ev}-gen12.html`
  );
}