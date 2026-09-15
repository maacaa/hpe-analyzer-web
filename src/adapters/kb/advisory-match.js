// Match firmware advisories against the versions extracted from an AHS file.
//
// Two dimensions:
//   1. An advisory resolves specific IML error codes (resolvesErrorCodes).
//   2. The advisory applies only if the AHS firmware version is affected.

import { FIRMWARE_ADVISORIES } from "./firmware-advisories.js";
import { advisoryStatus } from "../../domain/services/version-match.js";

// Pre-index advisories by the error codes they resolve, so per-error lookups
// don't rescan the full advisory list every time.
const ADVISORIES_BY_CODE = (() => {
  const byCode = new Map();
  for (const adv of FIRMWARE_ADVISORIES) {
    for (const code of adv.resolvesErrorCodes) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(adv);
    }
  }
  return byCode;
})();

/** Normalize a component category for advisory matching. */
function normalizeComponent(name) {
  if (/system rom/i.test(name)) return "System ROM";
  if (/iLO/i.test(name)) return "iLO (Lights-Out Management)";
  if (/power management/i.test(name)) return "Power Management Controller (PMC)";
  if (/network|ethernet|adapter/i.test(name)) return "Network";
  if (/storage controller|smart array/i.test(name)) return "Storage controller";
  return name;
}

/** Match a firmware component name to an advisory component category. */
function componentMatches(firmwareComponent, advisoryComponent) {
  const f = normalizeComponent(firmwareComponent);
  const a = normalizeComponent(advisoryComponent);
  return f === a;
}

/**
 * Find firmware versions in the AHS model for a given component.
 * @returns {Array<{name:string, version:string}>}
 */
function findComponentVersion(firmware, component) {
  const out = [];
  for (const f of firmware) {
    // Skip the redundant ROM copy; advisories target the primary component.
    if (/redundant/i.test(f.component)) continue;
    if (componentMatches(f.component, component)) {
      out.push({ name: f.component, version: f.version });
    }
  }
  return out;
}

/**
 * Build the "known issue" block for a single error code.
 *
 * @param {string} code e.g. "0032|0462"
 * @param {Array} firmware normalized firmware entries from the AHS
 * @returns {Array} list of matched advisories with per-server status
 */
export function matchAdvisoriesForError(code, firmware, platform) {
  const matches = [];
  for (const adv of ADVISORIES_BY_CODE.get(code) ?? []) {
    if (platform && adv.platforms.length && !adv.platforms.includes(platform)) continue;
    const versions = findComponentVersion(firmware, adv.component);
    const results = versions
      .map((v) => ({ ...v, component: v.name, ...advisoryStatus(v.name, v.version, adv) }))
      .filter(
        // dedupe identical (component, version) pairs so repeated boot records
        // do not flood the output
        (r, i, arr) => arr.findIndex((x) => x.name === r.name && x.version === r.version) === i
      );
    matches.push({
      id: adv.id,
      title: adv.title,
      description: adv.description,
      component: adv.component,
      affectedVersions: adv.affected,
      fixedIn: adv.fixedIn,
      severity: adv.severity,
      results,
    });
  }
  return matches;
}

/**
 * Build "known issue" blocks for a list of error codes.
 */
export function matchAdvisories(codes, firmware, platform) {
  const all = [];
  for (const code of codes) {
    all.push(...matchAdvisoriesForError(code, firmware, platform));
  }
  // dedupe by advisory id
  const seen = new Set();
  return all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

/**
 * Match advisories against the firmware present in the server, independent of
 * any IML error code. Tips-tab policy: an advisory is shown ONLY when at
 * least one installed component version falls inside its affected range, and
 * the per-component results are reduced to those affected versions (an
 * up-to-date component is not news worth reporting). Advisories matched
 * against error codes elsewhere (RCA) are unaffected by this rule.
 *
 * @param {Array} firmware normalized firmware entries from the AHS
 * @param {string|null} platform e.g. "Gen10" | "Gen11"
 * @returns {Array} matched advisories with per-server version status
 */
export function matchGeneralAdvisories(firmware, platform) {
  const matches = [];
  for (const adv of FIRMWARE_ADVISORIES) {
    if (platform && adv.platforms.length && !adv.platforms.includes(platform)) continue;
    const versions = findComponentVersion(firmware, adv.component);
    if (!versions.length) continue;
    const results = versions
      .map((v) => ({ ...v, component: v.name, ...advisoryStatus(v.name, v.version, adv) }))
      .filter(
        (r, i, arr) => arr.findIndex((x) => x.name === r.name && x.version === r.version) === i
      )
      // Tips are shown only when they are necessary: keep affected components
      // and drop the advisory entirely when nothing is affected.
      .filter((r) => r.affected);
    if (results.length === 0) continue;
    matches.push({
      id: adv.id,
      title: adv.title,
      description: adv.description,
      component: adv.component,
      affectedVersions: adv.affected,
      fixedIn: adv.fixedIn,
      severity: adv.severity,
      resolvesErrorCodes: adv.resolvesErrorCodes,
      results,
    });
  }
  return matches;
}
