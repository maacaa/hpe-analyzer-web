// @ts-check
// Firmware normalization, deduplication and platform detection (domain use case).

import { normalizeFirmware } from "../services/firmware-names.js";
import { parseVersion, compareVersions } from "../services/version-match.js";

/**
 * Normalize raw firmware entries to human-readable component names, merge the
 * bcert ROM family code into the current System ROM entry, and deduplicate by
 * component keeping the highest version.
 * @param {Array<{component:string, version:string, source:string}>} rawFirmware
 * @returns {import("../entities/model.js").FirmwareEntry[]}
 */
export function normalizeFirmwareSet(rawFirmware) {
  let normalized = rawFirmware.map((f) =>
    normalizeFirmware(f.component, f.version, f.source)
  );
  // Merge the bcert ROM family code into the current System ROM entry (zbb).
  const famIdx = normalized.findIndex(
    (f) => f.rawKey && /^(U|A|I)\d{2}$/.test(f.rawKey)
  );
  if (famIdx >= 0) {
    const family = normalized[famIdx].rawKey;
    for (const f of normalized) {
      if (f.component === "System ROM") {
        f.component = `System ROM (family ${family})`;
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
        (!cur && !prev && f.version.length > existing.version.length)
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