// @ts-check
// Post-parse pipeline shared by every delivery adapter (Electron, CLI, web).
// Takes a Model that already has raw records dispatched into it and produces
// the final normalized model consumed by the UI.

import {
  normalizeFirmwareSet,
  detectPlatform,
} from "./firmware.js";
import { buildRca } from "./iml-rca.js";
import { enrichHardware } from "./hardware-health.js";
import { finalizeEvents } from "./events.js";

/**
 * @param {import("../entities/model.js").Model} model
 * @param {import("../ports/kb-port.js").KbPort} kb
 * @returns {import("../entities/model.js").Model}
 */
export function finalizeModel(model, kb) {
  // sort IML newest -> oldest
  model.iml.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  // Normalize firmware and detect the platform generation.
  model.firmware = normalizeFirmwareSet(model.firmware);
  const platform = detectPlatform(model.meta.productName);

  // Firmware-version advisories independent of any IML error code (Tips tab).
  model.advisories = kb.matchGeneralAdvisories(model.firmware, platform);

  // Group critical events into the deduplicated RCA list.
  const { rca, criticalCount, warningCount } = buildRca(
    model.iml,
    model.firmware,
    platform,
    kb
  );
  model.rca = rca;
  model.stats.criticalCount = criticalCount;
  model.stats.warningCount = warningCount;
  model.stats.imlCount = model.iml.length;

  // Collapse event-log snapshot duplicates (newest first).
  model.events = finalizeEvents(model.events);
  model.stats.eventCount = model.events.length;

  // Derive per-component health status + system board entry (with board
  // firmware versions and total memory).
  enrichHardware(model.hardware, model.iml, model.meta, model.firmware);

  return model;
}
