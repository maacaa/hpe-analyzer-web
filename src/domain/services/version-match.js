// @ts-check
// Version parsing and comparison for firmware advisory matching.
//
// Firmware versions come in many shapes:
//   "2.54", "2.90p20", "04.01.04.505", "1.3310.0", "0.2.2.3", "HPG3", "0x31"
// Advisories reference components + affected/fixed versions that must be
// compared against the version actually reported inside the AHS.

/**
 * Parse a dotted numeric prefix into a comparable array of integers.
 * @param {string|null|undefined} str
 * @returns {number[]|null}
 */
export function parseVersion(str) {
  if (str == null) return null;
  let s = String(str).trim().toLowerCase();
  // Strip hex versions (CPLD) — not comparable with decimal ranges.
  if (/^0x[0-9a-f]+$/.test(s)) return null;
  // Leading "v"
  s = s.replace(/^v/, "");
  // Take only the dotted numeric prefix.
  const m = s.match(/^\d+(?:\.\d+)*/);
  if (!m) return null;
  return m[0].split(".").map((n) => parseInt(n, 10));
}

/**
 * Compare two version arrays. Returns <0, 0, or >0.
 * @param {number[]|null} a
 * @param {number[]|null} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Determine whether an AHS-reported version is affected by an advisory whose
 * affected state is described by `min`/`max` (inclusive) and/or `fixedIn`.
 *
 * @param {string} version
 * @param {{min?: string|null, max?: string|null}} range
 * @returns {boolean}
 */
export function isAffected(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  const lo = range.min != null ? parseVersion(range.min) : null;
  const hi = range.max != null ? parseVersion(range.max) : null;

  if (lo != null && hi != null) {
    return compareVersions(v, lo) >= 0 && compareVersions(v, hi) <= 0;
  }
  if (hi != null) {
    // "prior to / up to max" (inclusive) — affected when version <= max.
    return compareVersions(v, hi) <= 0;
  }
  if (lo != null) {
    // range starts at min (rare); affected when version >= min.
    return compareVersions(v, lo) >= 0;
  }
  return false;
}

/**
 * @typedef {object} AdvisoryStatus
 * @property {boolean} affected
 * @property {string} label
 * @property {string|null} fix
 */

/**
 * Human-readable status of a component version against an advisory.
 * @param {string} componentName
 * @param {string} version
 * @param {{affected?: {min?: string, max?: string}, fixedIn?: string, min?: string, max?: string}} advisory
 * @returns {AdvisoryStatus}
 */
export function advisoryStatus(componentName, version, advisory) {
  const range = advisory.affected ?? advisory;
  const affected = isAffected(version, range);
  const fixed = advisory.fixedIn ?? "a later release";
  if (affected) {
    return {
      affected: true,
      label: `Your ${componentName} version ${version} is AFFECTED by this known issue.`,
      fix: `Update ${componentName} to version ${fixed} or later.`,
    };
  }
  return {
    affected: false,
    label: `Your ${componentName} version ${version} already includes the fix (${fixed} or later).`,
    fix: null,
  };
}