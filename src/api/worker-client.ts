// Typed RPC client for the resident analysis worker (RNF-4).
//
// One worker per session. analyze() streams progress; query() fetches log
// pages; exportReport() renders the .txt report inside the worker (it owns
// the full model); cancel() terminates the worker, releasing every byte of
// analysis memory (RNF-11), and recreates it lazily on next use.

import type {
  AnalyzeResult,
  LogFilter,
  LogQueryResult,
  ProgressInfo,
  Summary,
  WorkerResponse,
} from "../types";

type ProgressCb = (p: ProgressInfo) => void;

interface Pending {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
}

export class AnalyzerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private progressCbs: ProgressCb[] = [];

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(
      new URL("../worker/analyze.worker.ts", import.meta.url),
      { type: "module" }
    );
    w.onmessage = (e: MessageEvent) => this.handle(e.data as WorkerResponse);
    w.onerror = (e: ErrorEvent) => {
      const err = new Error(
        e.message || e.filename
          ? `Worker error: ${e.message || e.filename || "unknown"}`
          : "Worker crashed"
      );
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  private handle(msg: WorkerResponse) {
    if (msg.type === "progress" && !("id" in msg)) {
      for (const cb of this.progressCbs) cb(msg.progress);
      return;
    }
    if (!("id" in msg)) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      if (msg.type === "analyzed") (p.resolve as (v: AnalyzeResult) => void)(msg.result);
      else if (msg.type === "query") (p.resolve as (v: LogQueryResult) => void)(msg.result);
      else if (msg.type === "export") (p.resolve as (v: Uint8Array) => void)(msg.pdf);
    } else {
      p.reject(new Error(msg.error));
    }
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    const w = this.ensure();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as unknown as (v: never) => void,
        reject,
      });
      // NOTE: File is structured-cloneable but NOT Transferable — passing it
      // in a transfer list throws DataCloneError in real browsers.
      w.postMessage({ ...payload, id });
    });
  }

  analyze(file: File, onProgress: ProgressCb): Promise<AnalyzeResult> {
    this.progressCbs.push(onProgress);
    return this.request<AnalyzeResult>({ type: "analyze", file }).finally(() => {
      this.progressCbs = this.progressCbs.filter((cb) => cb !== onProgress);
    });
  }

  /** Reopen a cached analysis by fingerprint (Recent files, RF-7). */
  openCached(fingerprint: string): Promise<AnalyzeResult> {
    return this.request<AnalyzeResult>({ type: "openCached", fingerprint });
  }

  query(tab: "iml" | "events", filter: LogFilter, page: number): Promise<LogQueryResult> {
    return this.request<LogQueryResult>({ type: "query", tab, filter, page });
  }

  /** Render the analysis report PDF inside the worker. */
  exportReport(): Promise<Uint8Array> {
    return this.request<Uint8Array>({ type: "export" });
  }

  /** Terminate the worker: all analysis memory is freed immediately. */
  cancel(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    const err = new Error("Cancelled");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.progressCbs = [];
  }
}
