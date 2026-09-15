// Application service: AHS File -> Model with O(chunk) memory (RNF-1).
//
// Same pipeline and output as analyzer-web.js, but gzip payloads (the .zbb
// blackbox records, which hold millions of log entries) are decompressed
// incrementally via DecompressionStream and fed to the incremental zbb
// scanner, so peak memory stays proportional to the chunk size instead of
// the record size. Small gzip records (bcert.pkg) and raw records are read
// whole, matching the original behavior.
//
// A failed/over-limit zbb record is dropped atomically: partial contributions
// are rolled back so the resulting model equals the whole-record path.

import {
  readAhsRecordHeaders,
  gunzipRecordChunks,
  gunzipRecord,
  readRecordData,
} from "../parsers/ahs-stream.js";
import { dispatchRecord, MAX_LOG_ENTRIES } from "../parsers/record-dispatch.js";
import { createZbbScanner } from "../parsers/zbb-stream.js";
import { makeZbbSink } from "../parsers/zbb-sink.js";
import { createDefaultKb } from "../kb/kb.js";
import { createEmptyModel } from "../../domain/entities/model.js";
import { finalizeModel } from "../../domain/usecases/finalize-model.js";
import {
  MAX_DECOMPRESSED,
  MAX_TOTAL_DECOMPRESSED,
} from "../parsers/ahs-browser.js";

/**
 * Analyze an AHS file from a browser File object using streaming reads.
 * @param {File} file
 * @param {(p:{phase:string, done:number, total:number, pct:number}) => void} [onProgress]
 * @param {{batchBytes?: number, maxDecompressed?: number, maxTotalDecompressed?: number}} [opts]
 * @returns {Promise<import("../../domain/entities/model.js").Model>}
 */
export async function analyzeWebStreaming(file, onProgress, opts = {}) {
  const batchBytes = opts.batchBytes ?? 8 * 1024 * 1024;
  const maxDecompressed = opts.maxDecompressed ?? MAX_DECOMPRESSED;
  const maxTotalDecompressed = opts.maxTotalDecompressed ?? MAX_TOTAL_DECOMPRESSED;

  const kb = createDefaultKb();
  const model = createEmptyModel(file.name);
  const totalBytes = file.size;
  let bytesDone = 0;
  let totalDecompressed = 0;

  const report = (phase) => {
    if (!onProgress) return;
    onProgress({
      phase,
      done: bytesDone,
      total: totalBytes,
      pct: Math.min(100, (bytesDone / totalBytes) * 100),
    });
  };

  for await (const head of readAhsRecordHeaders(file)) {
    model.stats.records++;
    bytesDone = head.dataStart;
    report(head.name);

    const isZbb = head.name.endsWith(".zbb") || head.name.endsWith(".bb");

    if (head.gzip && !isZbb) {
      // e.g. bcert.pkg: small bounded gzip record, read whole.
      let data = null;
      try {
        data = await gunzipRecord(file, head.dataStart, head.size, maxDecompressed);
        totalDecompressed += data.length;
        if (totalDecompressed > maxTotalDecompressed) {
          throw new Error("AHS decompressed size exceeds the total limit");
        }
      } catch {
        data = null; // gunzip failed: record skipped (as the whole-record path)
      }
      bytesDone = head.dataEnd;
      report(head.name);
      if (!data) continue;
      dispatchRecord(
        {
          name: head.name,
          size: head.size,
          bits: head.bits,
          checksum: head.checksum,
          large: head.large,
          data,
          error: null,
          offset: head.offset,
        },
        model,
        kb
      );
      continue;
    }

    if (!head.gzip) {
      const data = await readRecordData(file, head.dataStart, head.size);
      bytesDone = head.dataEnd;
      report(head.name);
      dispatchRecord(
        {
          name: head.name,
          size: head.size,
          bits: head.bits,
          checksum: head.checksum,
          large: head.large,
          data,
          error: null,
          offset: head.offset,
        },
        model,
        kb
      );
      continue;
    }

    // .zbb/.bb: stream through the incremental scanner (O(chunk) memory).
    if (model.iml.length + model.events.length >= MAX_LOG_ENTRIES) {
      model.meta.logEntryCapped = true;
      bytesDone = head.dataEnd;
      continue;
    }
    model.stats.zbbFiles++;
    // Snapshot BEFORE the zbbFiles increment above is reflected: the rollback
    // must restore the pre-record state (zbbFiles included).
    const snapshot = {
      iml: model.iml.length,
      events: model.events.length,
      firmware: model.firmware.length,
      zbbFiles: model.stats.zbbFiles - 1,
    };
    try {
      const scanner = createZbbScanner(makeZbbSink(model, kb, head.name));
      for await (const chunk of gunzipRecordChunks(file, head.dataStart, head.size, {
        maxOutput: maxDecompressed,
        batchBytes,
        onRead: (consumed) => {
          bytesDone = head.dataStart + consumed;
          report(head.name);
        },
      })) {
        totalDecompressed += chunk.byteLength;
        if (totalDecompressed > maxTotalDecompressed) {
          throw new Error("AHS decompressed size exceeds the total limit");
        }
        scanner.push(chunk);
      }
      scanner.end();
    } catch {
      // Roll back this record's partial contributions: a failed record is
      // dropped atomically, matching the whole-record path.
      model.iml.length = snapshot.iml;
      model.events.length = snapshot.events;
      model.firmware.length = snapshot.firmware;
      model.stats.zbbFiles = snapshot.zbbFiles;
    }
    bytesDone = head.dataEnd;
    report(head.name);
  }

  return finalizeModel(model, kb);
}
