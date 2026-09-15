// ZBB scan sink: applies scanned log entries / inline records / firmware
// versions to the analysis model. Shared by the whole-buffer path
// (record-dispatch.js) and the streaming path (analyzer-stream.js) so both
// produce identical models.

import { splitAction, parseLogDate } from "../../domain/services/iml-format.js";
import { createZbbScanner } from "./zbb-stream.js";
import { FW_NAME_VALUE } from "./zbb.js";

/**
 * Build the sink that folds scanned zbb findings into the model.
 * @param {import("../../domain/entities/model.js").Model} model
 * @param {import("../../domain/ports/kb-port.js").KbPort} kb
 * @param {string} recName
 */
export function makeZbbSink(model, kb, recName) {
  return {
    onEntry(e) {
      const severity = kb.resolveSeverity(e.classCode, e.eventCode, e.message);
      const { alarm, resolution } = splitAction(e.message);
      const ts = parseLogDate(e.date);
      const entry = {
        ...e,
        severity,
        alarm,
        resolution,
        timestamp: ts ? ts.getTime() : null,
        source: recName,
      };
      // IML tab = the error log (type 0x0B); Event Logs tab = the iLO
      // Event Log / IEL (type 0x0C, e.g. sessions, firmware, resets).
      if (e.logType === "iel") model.events.push(entry);
      else model.iml.push(entry);
    },
    onInline(iv) {
      if (/version|firmware|rom/i.test(iv.name)) {
        model.firmware.push({
          component: iv.name,
          version: iv.value,
          source: `${recName} (${iv.name})`,
        });
      }
    },
    onSystemIdentity(identity) {
      // System identity tuple (present in every zbb snapshot). It only fills
      // values the bcert did not provide, so DiagProcess keeps priority and
      // the fabrication PCA serial never pollutes the unit serial again.
      const meta = model.meta;
      if (!meta.serialNumber && identity.serialNumber) {
        meta.serialNumber = identity.serialNumber;
      }
      if (!meta.productId && identity.partNumber) {
        meta.productId = identity.partNumber;
      }
    },
    onFirmwareMatches(fwMatches, iloCandidates) {
      // Replicates extractFirmwareVersions output order: per-name matches in
      // FW_NAME_VALUE order (deduplicated by name+version), then the first
      // iLO version string found in document order.
      const out = [];
      for (const name of FW_NAME_VALUE) {
        for (const m of fwMatches) {
          if (m.name !== name) continue;
          if (!out.some((o) => o.name === name && o.version === m.version)) {
            out.push({ name, version: m.version });
          }
        }
      }
      if (iloCandidates.length > 0) {
        out.push({ name: "iLO", version: iloCandidates[0].version, date: iloCandidates[0].date });
      }
      for (const fw of out) {
        model.firmware.push({
          component: fw.name,
          version: fw.version,
          source: `${recName} (current)`,
        });
      }
    },
  };
}

/** Scan a fully-materialized zbb buffer into the model (whole-record path). */
export function scanZbbInto(model, data, kb, recName) {
  const scanner = createZbbScanner(makeZbbSink(model, kb, recName));
  scanner.push(data);
  scanner.end();
}
