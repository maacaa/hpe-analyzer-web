// @ts-check
// Firmware normalization, deduplication and platform detection (domain use case).

import { normalizeFirmware } from "../services/firmware-names.js";
import { parseVersion, compareVersions } from "../services/version-match.js";

/**
 * Normalize raw firmware entries to human-readable component names, merge the
 * bcert ROM family code into the current System ROM entry, and deduplicate by
 * component keeping the highest (and dated) version.
 * @param {Array<{component:string, version:string, source:string, date?:string|null}>} rawFirmware
 * @returns {import("../entities/model.js").FirmwareEntry[]}
 */
const ROM_MAIN = "BIOS (System ROM)";
/** "Oct 13 2020" (zbb iLO "built on") -> "10/13/2020", passthrough otherwise.
 * @param {string|undefined|null} date
 * @returns {string|undefined|null}
 */
function normalizeDate(date) {
  const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/.exec(String(date ?? ""));
  if (m) {
    const mm = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    }[m[1].toLowerCase()];
    if (mm) return `${mm}/${m[2].padStart(2, "0")}/${m[3]}`;
  }
  return date;
}

/**
 * Normalize raw firmware entries to human-readable component names, merge the
 * bcert ROM family code into the current System ROM entry, and deduplicate by
 * component keeping the highest (and dated) version.
 * @param {Array<{component:string, version:string, source:string, date?:string|null}>} rawFirmware
 * @returns {import("../entities/model.js").FirmwareEntry[]}
 */
export function normalizeFirmwareSet(rawFirmware) {
  let normalized = rawFirmware.map((f) => {
    const n = normalizeFirmware(f.component, f.version, f.source);
    // raw entries may carry a build date the normalizer cannot derive from
    // the version string alone (zbb iLO "built on", inline records, ...)
    const rawDate = normalizeDate(f.date);
    if (rawDate && !n.date) n.date = rawDate;
    return n;
  });
  // Merge the bcert ROM family code into the current System ROM entry (zbb).
  const famIdx = normalized.findIndex(
    (f) => f.rawKey && /^(U|A|I)\d{2}$/.test(f.rawKey)
  );
  if (famIdx >= 0) {
    // reuse the family entry's labelled component (includes the platform)
    const familyComponent = normalized[famIdx].component;
    for (const f of normalized) {
      if (f.component === ROM_MAIN) {
        f.component = familyComponent;
      }
    }
    normalized.splice(famIdx, 1);
  }
  // Deduplicate firmware by component, keeping the highest version (the most
  // recent) - the same component reports its version on every boot record.
  const byComponent = new Map();
  for (const f of normalized) {
    const existing = byComponent.get(f.component);
    if (!existing) {
      byComponent.set(f.component, f);
    } else {
      const cur = parseVersion(f.version);
      const prev = parseVersion(existing.version);
      if (
        (cur && prev && compareVersions(cur, prev) > 0) ||
        (!cur && !prev && f.version.length > existing.version.length) ||
        (cur && prev &&
          compareVersions(cur, prev) === 0 && !existing.date && f.date)
      ) {
        byComponent.set(f.component, f);
      }
    }
  }
  return [...byComponent.values()];
}

/** Detect the platform generation from the product name. */
/**
 * @param {string|unknown} productName
 * @returns {"Gen10"|"Gen10 Plus"|"Gen11"|null}
 */
export function detectPlatform(productName) {
  const name = String(productName ?? "");
  if (/Gen11/i.test(name)) return "Gen11";
  if (/Gen10 Plus/i.test(name) || /Gen10\+/i.test(name)) return "Gen10 Plus";
  if (/Gen10/i.test(name)) return "Gen10";
  return null;
}