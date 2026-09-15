// IML error -> resolution database.
//
// The primary source is the generated `IML_EVENTS` table (`iml-events.js`),
// built from the official HPE "Integrated Management Log Messages and
// Troubleshooting Guide for HPE ProLiant Gen10, Gen10 Plus, Gen11, and Gen12
// servers and HPE Synergy" (docId ilogen12-msg-en_us). Each event links the
// official HPE resolution (`action`) and symptom/cause text.
//
// A small curated table supplements events not present in that guide.

import { IML_EVENTS } from "./iml-events.js";

/** Codes not covered by the guide, curated from other official HPE sources. */
const CURATED = {
  "0023|044e": {
    title: "Server Could Not Be Powered On",
    resolution:
      "The server could not be powered on or a critical error occurred. Check power connectivity, power supplies, and review the IML for the root cause.",
    severity: "critical",
    category: "power",
  },
  "0023|0491": {
    title: "System Security State at Risk",
    resolution:
      "Refer to the iLO user manual or the Security Dashboard to review and resolve the security risks.",
    severity: "warning",
    category: "security",
  },
  "0037|0005": {
    title: "System Security State at Risk",
    resolution:
      "Refer to the iLO user manual or the Security Dashboard to review and resolve the security risks.",
    severity: "warning",
    category: "security",
  },
  "0037|1616": {
    title: "System Security State at Risk",
    resolution:
      "Refer to the iLO user manual or the Security Dashboard to review and resolve the security risks.",
    severity: "warning",
    category: "security",
  },
};

const DB = {};
for (const e of IML_EVENTS) {
  const key =
    e.class.toString(16).padStart(4, "0") +
    "|" +
    e.event.toString(16).padStart(4, "0");
  DB[key] = {
    title: e.title,
    resolution: e.action,
    symptom: e.symptom,
    cause: e.cause,
    severity: e.severity,
    category: e.category,
    platforms: e.platforms,
    url: e.url,
  };
}

/** Combined database: official guide entries + curated supplements. */
export const IML_RESOLUTIONS = { ...DB, ...CURATED };

/** Number of entries backed by the official guide. */
export const IML_DB_SIZE = Object.keys(DB).length;

/**
 * Look up the resolution for an IML event. Falls back to the "ACTION:" text
 * embedded in the message when the code is not in the database.
 */
export function resolveRcaError(classCode, eventCode, message) {
  const key =
    classCode.toString(16).padStart(4, "0") +
    "|" +
    eventCode.toString(16).padStart(4, "0");
  const entry = IML_RESOLUTIONS[key];
  if (entry) {
    return {
      title: entry.title,
      resolution: entry.resolution,
      symptom: entry.symptom ?? null,
      cause: entry.cause ?? null,
      severity: entry.severity ?? null,
      category: entry.category ?? null,
      platforms: entry.platforms ?? null,
      url: entry.url ?? null,
    };
  }
  // Fallback: the ACTION: text embedded in the message (official HPE wording).
  const idx = message.indexOf("ACTION:");
  const resolution =
    idx >= 0 ? message.slice(idx + "ACTION:".length).trim() : null;
  return { title: null, resolution, symptom: null, cause: null, severity: null, category: null, platforms: null, url: null };
}