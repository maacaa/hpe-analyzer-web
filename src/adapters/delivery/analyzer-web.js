// Application service: AHS File -> Model (browser edition, whole-record).
//
// Same pipeline as the Electron analyzer but reads from a browser File object
// instead of an OS file path. No node:fs, no node:path. Kept as the reference
// implementation for the streaming equivalence tests; the production path is
// analyzer-stream.js (O(chunk) memory).

import { readAhsRecordsBrowser } from "../parsers/ahs-browser.js";
import { dispatchRecord } from "../parsers/record-dispatch.js";
import { createDefaultKb } from "../kb/kb.js";
import { createEmptyModel } from "../../domain/entities/model.js";
import { finalizeModel } from "../../domain/usecases/finalize-model.js";

const kb = createDefaultKb();

/**
 * Analyze an AHS file from a browser File object.
 * @param {File} file
 * @param {(p:{phase:string, done:number, total:number, pct:number}) => void} [onProgress]
 * @returns {Promise<import("../../domain/entities/model.js").Model>}
 */
export async function analyzeWeb(file, onProgress) {
  const totalBytes = file.size;
  const model = createEmptyModel(file.name);

  let bytesDone = 0;
  for await (const rec of readAhsRecordsBrowser(file)) {
    model.stats.records++;
    bytesDone += rec.size + 116;
    if (onProgress) {
      onProgress({
        phase: rec.name,
        done: bytesDone,
        total: totalBytes,
        pct: Math.min(100, (bytesDone / totalBytes) * 100),
      });
    }
    if (rec.error || !rec.data) continue;
    dispatchRecord(rec, model, kb);
  }

  return finalizeModel(model, kb);
}
