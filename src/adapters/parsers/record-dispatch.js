// Record dispatcher (interface adapter): decodes a raw AHS record and applies
// its contributions to the analysis model. Byte-level decoding lives in the
// parser adapters; severity/action formatting come from the domain services.

import {
  parseCustInfo,
  parseFilePkg,
  parseClist,
  parseCounters,
  parseBcert,
} from "./subformats.js";
import { classifyBcert } from "./classify.js";
import { scanZbbInto } from "./zbb-sink.js";

// Cap on total collected log entries (IML + iLO Event Log). A hostile AHS file
// could otherwise inject millions of entries and hang the UI/IPC. Real-world
// files stay well below this (~700k max observed), so the cap only triggers on
// pathological input and is reported via meta.logEntryCapped.
export const MAX_LOG_ENTRIES = 2_000_000;

/**
 * Apply one raw record to the model.
 *
 * @param {import("../../domain/ports/ahs-source.js").RawRecord} rec
 * @param {import("../../domain/entities/model.js").Model} model
 * @param {import("../../domain/ports/kb-port.js").KbPort} kb
 */
export function dispatchRecord(rec, model, kb) {
  switch (rec.name) {
    case "CUST_INFO.DAT":
      model.customerInfo = parseCustInfo(/** @type {Uint8Array} */ (rec.data));
      break;
    case "file.pkg":
      model.fileListing = parseFilePkg(/** @type {Uint8Array} */ (rec.data))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      break;
    case "clist.pkg":
      model.clist = parseClist(/** @type {Uint8Array} */ (rec.data));
      break;
    case "counters.pkg":
      model.counters = parseCounters(/** @type {Uint8Array} */ (rec.data));
      break;
    case "bcert.pkg":
      try {
        const classified = classifyBcert(parseBcert(/** @type {Uint8Array} */ (rec.data)));
        model.firmware.push(...classified.firmware);
        model.hardware.push(...classified.hardware);
        Object.assign(model.meta, classified.meta);
      } catch (err) {
        model.meta.bcertError = /** @type {Error} */ (err).message;
      }
      break;
    default:
      if (rec.name.endsWith(".zbb") || rec.name.endsWith(".bb")) {
        // Once the log-entry budget is exhausted, stop collecting further
        // entries (bounded memory/CPU for pathological files).
        if (model.iml.length + model.events.length >= MAX_LOG_ENTRIES) {
          model.meta.logEntryCapped = true;
          return;
        }
        model.stats.zbbFiles++;
        // The incremental scanner over the full buffer yields exactly the
        // same entries/inline records/firmware versions as the whole-buffer
        // extractors (verified by the chunk-boundary equivalence tests).
        scanZbbInto(model, /** @type {Uint8Array} */ (rec.data), kb, rec.name);
      }
      break;
  }
}