// Web Worker: resident analysis model + query-response RPC (RNF-4/5).
//
// The full Model (up to millions of IML/Event rows) lives here for the whole
// session. The renderer only ever receives:
//   - the small summary (meta, stats, firmware, hardware, rca, advisories)
//   - query result pages (~500 rows) for the IML / Event Log tabs
// Filtering runs inside the worker via LogQueryEngine (lazy per-criteria
// index + LRU cache); the .txt report is also rendered here because the
// full model never leaves this context.
//
// IndexedDB cache (RF-12): analyze() first fingerprints the file (cheap,
// head+tail 64 KiB); a cache hit loads the stored model instantly instead of
// re-parsing. After a full analysis the model is stored under the same
// fingerprint. openCached() restores a model by fingerprint (Recent files).

import { analyzeWebStreaming } from "../adapters/delivery/analyzer-stream.js";
import { LogQueryEngine } from "./log-query.js";
import { buildPdfReport } from "./pdf-report.js";
import { fingerprintFile } from "../cache/fingerprint.js";
import { AnalysisCache } from "../cache/analysis-cache.js";
import type {
  AnalyzeResult,
  Summary,
  WorkerRequest,
  WorkerResponse,
} from "../types";

const ctx = self as unknown as {
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  onunhandledrejection: ((e: { reason?: unknown }) => void) | null;
};

// Report any uncaught worker error to the UI instead of dying silently:
// the renderer's onerror then shows the real cause, not a generic crash.
ctx.onerror = (e) => {
  console.error("[worker error]", e?.message);
};
ctx.onunhandledrejection = (e) => {
  console.error(
    "[worker unhandled rejection]",
    e?.reason instanceof Error ? e.reason.message : String(e?.reason)
  );
};

const cache = new AnalysisCache();

let model: Record<string, unknown> | null = null;
let engine: LogQueryEngine | null = null;

function post(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

function makeSummary(): Summary {
  const m = model as {
    iml: unknown;
    events: unknown;
    [k: string]: unknown;
  };
  const { iml: _iml, events: _events, ...summary } = m;
  return summary as unknown as Summary;
}

function installModel(m: Record<string, unknown>) {
  model = m;
  engine = new LogQueryEngine(m.iml as never, m.events as never);
}

async function runAnalyze(id: number, file: File) {
  model = null;
  engine = null;
  try {
    const fingerprint = await fingerprintFile(file);
    let cached = null;
    try {
      cached = await cache.get(fingerprint);
    } catch (err) {
      // Best-effort cache (IndexeDB may be blocked/upgrade-busy): a cache
      // failure must never stop the analysis itself.
      console.warn("[cache] get failed:", err instanceof Error ? err.message : err);
    }
    if (cached && cached.model) {
      installModel(cached.model as Record<string, unknown>);
      post({
        id,
        ok: true,
        type: "analyzed",
        result: { summary: makeSummary(), fingerprint, fromCache: true },
      });
      return;
    }

    const m = (await analyzeWebStreaming(file, (progress) => {
      post({ type: "progress", progress });
    })) as unknown as Record<string, unknown>;
    installModel(m);
    try {
      await cache.put({
        fingerprint,
        name: file.name,
        size: file.size,
        analyzedAt: Date.now(),
        model: m,
      });
    } catch (err) {
      console.warn(
        "[cache] put failed (analysis kept):",
        err instanceof Error ? err.message : err
      );
    }
    post({
      id,
      ok: true,
      type: "analyzed",
      result: { summary: makeSummary(), fingerprint, fromCache: false },
    });
  } catch (err) {
    model = null;
    engine = null;
    post({
      id,
      ok: false,
      type: "analyzed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function openCached(id: number, fingerprint: string) {
  model = null;
  engine = null;
  void (async () => {
    try {
      const cached = await cache.get(fingerprint);
      if (!cached || !cached.model) {
        post({
          id,
          ok: false,
          type: "openCached",
          error: "Cached analysis not found. Analyze the file again.",
        });
        return;
      }
      installModel(cached.model as Record<string, unknown>);
      post({
        id,
        ok: true,
        type: "analyzed",
        result: { summary: makeSummary(), fingerprint, fromCache: true },
      });
    } catch (err) {
      post({
        id,
        ok: false,
        type: "openCached",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as WorkerRequest;
  switch (msg.type) {
    case "analyze":
      void runAnalyze(msg.id, msg.file);
      break;
    case "openCached":
      openCached(msg.id, msg.fingerprint);
      break;
    case "query": {
      if (!engine) {
        post({ id: msg.id, ok: false, type: "query", error: "No analysis loaded" });
        break;
      }
      try {
        const result = engine.queryRows(msg.tab, msg.filter, msg.page);
        post({ id: msg.id, ok: true, type: "query", result });
      } catch (err) {
        post({
          id: msg.id,
          ok: false,
          type: "query",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
    case "export": {
      if (!model) {
        post({ id: msg.id, ok: false, type: "export", error: "No analysis loaded" });
        break;
      }
      void (async () => {
        try {
          const m = model as unknown as { meta?: { sourceFile?: string } };
          const fileName = String(m?.meta?.sourceFile ?? "analysis-report.ahs");
          const { pdf } = await buildPdfReport(
            model as unknown as Summary,
            fileName
          );
          // transfer the buffer: the report bytes never need to outlive here
          ctx.postMessage(
            { id: msg.id, ok: true, type: "export", pdf },
            [pdf.buffer as ArrayBuffer]
          );
        } catch (err) {
          post({
            id: msg.id,
            ok: false,
            type: "export",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      break;
    }
  }
};
