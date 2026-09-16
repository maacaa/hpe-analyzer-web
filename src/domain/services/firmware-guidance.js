// @ts-check
// "Software tips" derived from error context.
//
// When an IML error's HPE guidance claims the firmware is outdated but no
// official advisory applies to the installed version, the recovery must still
// tell the user the truth: which component is implicated, what version the AHS
// reports for it, and which version resolves the issue (or the latest SPP).
// The same guidance is exposed as a Tips-tab advisory (with version info and
// the underlying known bug) so the user sees it even outside the RCA card.

import { parseVersion, compareVersions } from "./version-match.js";

/**
 * Firmware component families we can confidently name in an error context,
 * mapped to a regex that matches normalized catalog component names.
 */
const COMPONENT_PATTERNS = [
  { display: "System ROM", re: /system\s*rom/i, fw: /system\s*rom(?!.*redundant)/i },
  { display: "iLO firmware", re: /\bilo\b/i, fw: /\bilo\b|lights.out/i },
  {
    display: "Storage controller firmware",
    re: /smart\s*array|storage\s*controller|drive\s*(and|&)?\s*controller/i,
    fw: /smart\s*array|storage|cache|drive/i,
  },
  { display: "System CPLD", re: /\bcpld\b|programmable logic/i, fw: /cpld|programmable logic/i },
  {
    display: "Power Management Controller firmware",
    re: /power management|pmc\b/i,
    fw: /power management/i,
  },
  {
    display: "Device firmware",
    re: /card firmware|device firmware|adapter firmware/i,
    fw: /network|adapter|flexiblelom|ethernet/i,
  },
];

/** Component-name matcher across advisory and firmware naming.
 * @param {string} name
 * @returns {RegExp}
 */
function matchNameOf(name) {
  if (/system rom/i.test(name)) return /system\s*rom/i;
  if (/ilo/i.test(name)) return /ilo|lights.out/i;
  if (/smart array|storage/i.test(name)) return /smart\s*array|storage/i;
  if (/cpld/i.test(name)) return /cpld/i;
  if (/power management/i.test(name)) return /power management/i;
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/**
 * Extract a concrete version hint from HPE recovery text, e.g.
 * "Enter System ROM 2.20 in the search bar" -> { pattern: <family>, version: "2.20" }.
 * @param {string|null} resolution
 * @returns {{pattern: (typeof COMPONENT_PATTERNS)[number]|null, version: string}|null}
 */
export function versionHint(resolution) {
  if (!resolution) return null;
  const rom = /System ROM\s+(\d+(?:\.\d+)?)/i.exec(resolution);
  if (rom) return { pattern: COMPONENT_PATTERNS[0], version: rom[1] };
  const generic = /firmware[^.#\d]*([0-9]+\.[0-9]{1,2})(?!\d)/.exec(resolution);
  if (generic) {
    return { pattern: null, version: generic[1] };
  }
  return null;
}

/**
 * Installed (deduplicated, highest) versions for a family pattern.
 * @param {Array<{component:string, version:string}>} firmware
 * @param {RegExp|null} fwPattern
 */
export function installedVersions(firmware, fwPattern) {
  if (!fwPattern) return [];
  const out = /** @type {{component:string, version:string}[]} */ ([]);
  for (const f of firmware) {
    if (/redundant/i.test(f.component)) continue;
    if (fwPattern.test(f.component)) {
      const prev = out.find((v) => v.component === f.component);
      if (prev === undefined) {
        out.push({ component: f.component, version: f.version });
      } else if (f.version.length > prev.version.length) {
        prev.component = f.component;
        prev.version = f.version;
      }
    }
  }
  return out;
}

/**
 * Build the version-aware firmware guidance for an error whose HPE cause
 * blames an outdated firmware.
 *
 * @param {string} title        error title
 * @param {string|null} cause   original HPE cause text
 * @param {string|null} resolution original HPE resolution/action
 * @param {Array<{component:string, version:string}>} firmware AHS firmware
 * @param {Array<{id:string, title:string, component:string, fixedIn:string,
 *                description:string}>} bugs advisories for this error code
 * @param {string} hexKey       "class|event" code key, used for tip ids
 * @returns {{
 *   cause: string|null,
 *   resolution: string|null,
 *   tips: Array<object>,
 * }}
 */
export function buildFirmwareGuidance(title, cause, resolution, firmware, bugs, hexKey) {
  const text = `${title} ${cause ?? ""} ${resolution ?? ""}`;
  const hint = versionHint(resolution);

  // Families named in the guidance text, plus any family the hint names.
  const named = COMPONENT_PATTERNS.filter((p) => p.re.test(text));
  if (hint?.pattern && !named.includes(hint.pattern)) named.push(hint.pattern);

  // What the server actually has installed.
  const guidance = /** @type {{display:string, component:string, installed:string}[]} */ ([]);
  for (const p of named) {
    for (const v of installedVersions(firmware, p.fw)) {
      if (!guidance.some((g) => g.component === v.component)) {
        guidance.push({ display: p.display, component: v.component, installed: v.version });
      }
    }
  }
  if (guidance.length === 0) {
    // The implicated component is not identifiable in the AHS firmware
    // inventory: do not parrot the (unverified) "firmware out of date" claim.
    return {
      cause:
        "Device is failing.\nFirmware check: the AHS does not report the implicated component's version — verify it manually in iLO (firmware inventory / System Storage) before diagnosing.",
      resolution:
        "Verify the implicated component's firmware version in iLO and update it to the version documented for this issue or the latest SPP (http://www.hpe.com/servers/spp) before concluding the device itself is failing.",
      tips: [],
    };
  }

  // Known bug: prefer an advisory resolving this error code (even when the
  // installed version is not inside the affected range), otherwise any
  // advisory for the implicated component.
  const bug =
    bugs.find(
      (b) =>
        b.fixedIn && guidance.some((g) => matchNameOf(b.component).test(g.component))
    ) ??
    bugs.find((b) => b.fixedIn) ??
    null;
  const fixedIn = bug?.fixedIn ?? hint?.version ?? null;

  // Per-component status: is the installed version behind the documented fix?

  const statuses = guidance.map((g) => {
    const inst = parseVersion(g.installed);
    const fix = fixedIn ? parseVersion(fixedIn) : null;
    const behind = fixedIn && inst ? compareVersions(inst, fix) < 0 : null;
    return { ...g, state: behind === null ? "unknown" : behind ? "behind" : "current" };
  });

  const behindItems = statuses.filter((g) => g.state === "behind");
  const currentItems = statuses.filter((g) => g.state === "current");

  const target = fixedIn ? `version ${fixedIn} or later` : "the latest version available in the current SPP";

  // Cause: state which components are behind and which already include the fix.
  const causeParts = [];
  if (behindItems.length) {
    causeParts.push(
      "Firmware is not the latest version (" +
        behindItems.map((g) => `${g.component} is at version ${g.installed}, the fix ships in ${fixedIn}`).join("; ") +
        ")."
    );
  }
  if (currentItems.length) {
    causeParts.push(
      "The installed firmware already includes the documented fix (" +
        currentItems.map((g) => `${g.component} runs ${g.installed}, fixed in ${fixedIn}`).join("; ") +
        ")."
    );
  }
  if (causeParts.length === 0) {
    causeParts.push(
      `Firmware version could not be confirmed from the AHS (no ${statuses.map((g) => g.display).join("/")} record).`
    );
  }
  const nextCause = `${behindItems.length ? "Possible causes:\n" : ""}${causeParts.join("\n")}\nDevice is failing.`;

  // Policy: the Tips tab only reports a firmware issue when at least one
  // component is actually BEHIND the documented fix. An up-to-date component
  // is not news — the RCA card still states the check, and when the implicated
  // component cannot be versioned from the AHS the firmware claim is dropped
  // (the installed firmware is current/unverifiable, not "out of date").
  if (behindItems.length === 0) {
    const verified = currentItems.length
      ? currentItems.map((g) => `${g.component} ${g.installed} (fix introduced in ${fixedIn})`).join(", ")
      : null;
    const cause =
      (verified
        ? `Device is failing.\nFirmware check: ${verified} — the installed firmware already covers the documented fix, so "outdated firmware" is ruled out for it.`
        : "Device is failing.\nFirmware check: the AHS does not report the implicated component, so its version needs manual verification (iLO > System Storage / firmware inventory)."
      ).trim();
    const targetList = statuses.map((s) => s.component).join("/");
    const resolution =
      `Firmware is up to date for the implicated components${verified ? `: ${verified}` : ""}.\n\n` +
      `1. Verify the implicated component's firmware in iLO (System Storage / main menu firmware inventory) and the current SPP (http://www.hpe.com/servers/spp).\n` +
      `2. Power the server off, reseat the implicated device (${targetList}) and run the OFFLINE diagnostics.\n` +
      `3. If the error recurs with current firmware, open an HPE support case to diagnose the device.`;
    return { cause, resolution, tips: [] };
  }

  let nextResolution;
  if (behindItems.length === statuses.length) {
    nextResolution =
      `Update the implicated firmware before diagnosing a hardware failure:\n\n` +
      statuses
        .map(
          (g, i) => `${i + 1}. ${g.component} runs version ${g.installed} — update its firmware to ${target}.`
        )
        .join("\n") +
      `\n${statuses.length + 1}. Download the current Service Pack for ProLiant (SPP) from http://www.hpe.com/servers/spp and apply it before concluding the device itself is failing.` +
      `\n${statuses.length + 2}. After the update, reboot and clear the IML: if the error returns, the device (not the firmware) is failing.`;
  } else {
    nextResolution =
      `Update the implicated firmware before diagnosing a hardware failure:\n\n` +
      statuses
        .map(
          (g, i) =>
            `${i + 1}. ${g.component} runs version ${g.installed} — ${
              g.state === "behind"
                ? `update its firmware to ${target}.`
                : `is already at or above the documented fix (${fixedIn}); keep it up to date with each new SPP.`
            }`
        )
        .join("\n") +
      `\n${statuses.length + 1}. Download the current Service Pack for ProLiant (SPP) from http://www.hpe.com/servers/spp and apply it before concluding the device itself is failing.` +
      `\n${statuses.length + 2}. After the update, reboot and clear the IML: if the error returns, the device (not the firmware) is failing.`;
  }

  // Only components actually BEHIND the documented fix produce a Tips entry.
  const tips = behindItems.map((g, i) => ({
    id: `swtip-${hexKey}-${i}`,
    title: `Firmware not current: ${g.component} runs ${g.installed}`,
    description:
      (bug
        ? `Known firmware issue (${bug.id}): ${bug.title}. ${bug.description}`
        : `The "${title}" error is resolved by updating this component's firmware.`) +
      (fixedIn ? "" : " HPE recommends keeping the firmware at the latest SPP for your platform."),
    component: g.component,
    affectedVersions: {},
    fixedIn: fixedIn ?? "latest SPP",
    severity: "critical",
    resolvesErrorCodes: hexKey.length === 9 ? [hexKey] : [],
    results: [
      {
        component: g.component,
        version: g.installed,
        affected: true,
        name: g.component,
        label: `${g.component} is at version ${g.installed}; the fix for this issue ships in ${fixedIn}.`,
        fix: fixedIn
          ? `Update ${g.component} to ${fixedIn} or later.`
          : `Update ${g.component} to the latest version available in the SPP.`,
      },
    ],
  }));

  return { cause: nextCause, resolution: nextResolution, tips };
}
