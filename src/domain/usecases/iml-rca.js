// @ts-check
// Root-cause analysis use case: build the deduplicated RCA list from the IML
// error log, cross-referencing the KB (official titles/resolutions) and
// firmware advisories.

import { imlDocUrl } from "../services/iml-format.js";
import { buildPlaybook } from "../services/critical-playbook.js";
import { buildFirmwareGuidance } from "../services/firmware-guidance.js";

/** Extract the hardware component(s) affected by a critical IML message. */
/**
 * @param {string} alarm
 * @returns {string}
 */
export function extractComponent(alarm) {
  const paren = alarm.match(/\(([^)]*)\)/);
  if (paren) {
    const parts = paren[1]
      .split(",")
      .map((s) => s.trim())
      .filter((t) => /^(Processor|DIMM|Slot|Fan|Power Supply|Mezzanine)\s+\d+/i.test(t));
    if (parts.length) return parts.join(" · ");
  }
  const procs = alarm.match(/\bProcessor\s+\d+\b/g) || [];
  const dimms = alarm.match(/\bDIMM\s+\d+\b/g) || [];
  const slots = alarm.match(/\bSlot\s+\d+\b/g) || [];
  return [...procs, ...dimms, ...slots].join(" · ");
}

/** Normalize a critical alarm into a stable title + component descriptor. */
/**
 * @param {string} alarm
 * @returns {{title:string, component:string}}
 */
export function normalizeCriticalAlarm(alarm) {
  // Title ends at the first ". " or at a component-list "(" (e.g. "(Processor 2, ..."),
  // while keeping abbreviations in the error type such as "(BIST)".
  const dot = alarm.indexOf(". ");
  const compParen = alarm.search(
    / \((Processor|DIMM|APIC|Bank|Segment|Bus|Slot|Fan|Power Supply)/
  );
  const end = Math.min(
    dot >= 0 ? dot : alarm.length,
    compParen >= 0 ? compParen : alarm.length
  );
  const title = alarm.slice(0, end).replace(/[.\s]+$/, "");
  return { title, component: extractComponent(alarm) };
}

/**
 * Detect HPE guidance that blames an outdated firmware ("Firmware is
 * out-of-date", "Firmware is not the latest version", "Update the firmware...").
 * @param {string|null} cause
 * @param {string|null} resolution
 * @returns {boolean}
 */
function blamesOutdatedFirmware(cause, resolution) {
  return Boolean(
    (cause && /firmware is (out-of-date|not the latest version)/i.test(cause)) ||
      (resolution && /update (the )?firmware (to the latest|—)/i.test(resolution)) ||
      (resolution && /system rom 2\.20|update to the latest firmware version/i.test(resolution))
  );
}

/**
 * Rebuild the HPE cause/resolution for an error without matching advisory
 * tips: the guidance keeps naming the component, now with the version
 * actually installed in the AHS and the version that resolves the issue, and
 * the same information is exposed as Tips-tab advisories.
 * @param {string|null} cause
 * @param {string|null} resolution
 * @param {string} title
 * @param {import("../entities/model.js").FirmwareEntry[]} firmware
 * @param {any} bugs
 * @param {string} hexKey
 * @returns {{cause: string|null, resolution: string|null, tips: any[]}}
 */

/**
 * Rebuild the HPE cause/resolution for an error without matching advisory
 * tips: the guidance keeps naming the component, now with the version
 * actually installed in the AHS and the version that resolves the issue, and
 * the same information is exposed as Tips-tab advisories.
 * @param {string|null} cause
 * @param {string|null} resolution
 * @param {string} title
 * @param {import("../entities/model.js").FirmwareEntry[]} firmware
 * @param {any} bugs
 * @param {string} hexKey
 * @returns {{cause: string|null, resolution: string|null, tips: any[]}}
 */
function guidanceWithoutTips(cause, resolution, title, firmware, bugs, hexKey) {
  // @ts-expect-error: bugs come from the untyped KB port
  const hasAffectedTip = bugs.some((b) => b.results?.some((r) => r.affected));
  if (hasAffectedTip) return { cause, resolution, tips: [] };
  return buildFirmwareGuidance(title, cause, resolution, firmware, bugs, hexKey);
}

/**
 * Group critical IML events by error type (class|event). Each error type
 * appears once with a repetition counter, affected components, and any related
 * firmware advisories.
 *
 * @param {import("../entities/model.js").ImlEntry[]} iml
 * @param {import("../entities/model.js").FirmwareEntry[]} firmware
 * @param {string|null} platform
 * @param {import("../ports/kb-port.js").KbPort} kb
 * @returns {{ rca: import("../entities/model.js").RcaEntry[], softwareTips: any[], criticalCount: number, warningCount: number }}
 */
export function buildRca(iml, firmware, platform, kb) {
  const buckets = new Map();
  const tips = /** @type {any[]} */ ([]);
  let criticalCount = 0;
  let warningCount = 0;
  for (const e of iml) {
    if (e.severity === "critical") {
      criticalCount++;
      const hexKey = `${e.classCode.toString(16).padStart(4, "0")}|${e.eventCode.toString(16).padStart(4, "0")}`;
      const { title, component } = normalizeCriticalAlarm(e.alarm);
      const entry = kb.resolveRcaError(e.classCode, e.eventCode, e.message);
      const finalTitle = entry?.title ?? title;
      if (!buckets.has(hexKey)) {
        const bugs = kb.matchAdvisories([hexKey], firmware, platform);
        buckets.set(hexKey, {
          title: finalTitle,
          resolution: entry.resolution ?? e.resolution,
          cause: entry.cause ?? null,
          symptom: entry.symptom ?? null,
          category: entry.category ?? null,
          platforms: entry.platforms ?? null,
          playbook: buildPlaybook(e.alarm, finalTitle, entry.category ?? null),
          bugs,
          severity: e.severity,
          classCode: e.classCode,
          eventCode: e.eventCode,
          docUrl: entry.url ?? imlDocUrl(e.classCode, e.eventCode),
          components: new Set(),
          count: 0,
          lastDate: e.date,
          lastTimestamp: e.timestamp,
        });
      }
      const b = buckets.get(hexKey);
      b.count++;
      if (component) b.components.add(component);
      if ((e.timestamp ?? 0) > (b.lastTimestamp ?? 0)) {
        b.lastDate = e.date;
        b.lastTimestamp = e.timestamp;
      }
    } else if (e.severity === "warning") {
      warningCount++;
    }
  }
  const rca = [...buckets.values()]
    .map((b) => {
      const hpeTexts = blamesOutdatedFirmware(b.cause, b.resolution)
        ? guidanceWithoutTips(b.cause, b.resolution, b.title, firmware, b.bugs, hexKeyOf(b))
        : { cause: b.cause, resolution: b.resolution, tips: [] };
      tips.push(...hpeTexts.tips);
      return { ...b, cause: hpeTexts.cause, resolution: hpeTexts.resolution, components: [...b.components] };
    })
    .sort((a, b) => (b.lastTimestamp ?? 0) - (a.lastTimestamp ?? 0));
  return { rca, softwareTips: tips, criticalCount, warningCount };
}

/** @internal rebuild the "class|event" hex key from an RCA bucket
 * @param {{classCode:number, eventCode:number}} b
 * @returns {string}
 */
function hexKeyOf(b) {
  return `${b.classCode.toString(16).padStart(4, "0")}|${b.eventCode.toString(16).padStart(4, "0")}`;
}