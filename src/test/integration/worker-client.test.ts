// AnalyzerClient RPC protocol tests with a fake Worker that implements the
// same message protocol as analyze.worker.ts (analyze/query/export/cancel).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AnalyzerClient } from "../../api/worker-client";
import { analyzeWeb } from "../../adapters/delivery/analyzer-web.js";
import { LogQueryEngine } from "../../worker/log-query.js";
import { buildRecord, buildLogRecord, u8concat } from "../helpers.js";
import type { WorkerRequest, WorkerResponse } from "../../types";

const te = new TextEncoder();

interface FakeWorkerInit {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  postMessage(msg: { id?: number; type: string; file?: File }): void;
  terminate(): void;
}

let lastWorker: FakeWorkerImpl | null = null;

class FakeWorkerImpl {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  private model: Record<string, unknown> | null = null;
  private engine: LogQueryEngine | null = null;

  constructor() {
    lastWorker = this;
  }

  postMessage(msg: { id?: number; type: string; file?: File }) {
    const id = msg.id ?? -1;
    void this.handle(msg as WorkerRequest, id);
  }

  terminate() {
    this.terminated = true;
  }

  private post(res: WorkerResponse) {
    this.onmessage?.(new MessageEvent("message", { data: res }));
  }

  private async handle(msg: WorkerRequest, id: number) {
    if (msg.type === "analyze") {
      try {
        const m = (await analyzeWeb(msg.file!, (progress) =>
          this.post({ type: "progress", progress })
        )) as unknown as Record<string, unknown>;
        this.model = m;
        this.engine = new LogQueryEngine(m.iml as never, m.events as never);
        const { iml: _i, events: _e, ...summary } = m;
        this.post({
          id,
          ok: true,
          type: "analyzed",
          result: { summary, fingerprint: "fp-test", fromCache: false },
        } as WorkerResponse);
      } catch (err) {
        this.post({
          id,
          ok: false,
          type: "analyzed",
          error: err instanceof Error ? err.message : String(err),
        } as WorkerResponse);
      }
    } else if (msg.type === "openCached") {
      this.post({
        id,
        ok: false,
        type: "openCached",
        error: "Cached analysis not found. Analyze the file again.",
      } as WorkerResponse);
    } else if (msg.type === "query") {
      if (!this.engine) {
        this.post({ id, ok: false, type: "query", error: "No analysis loaded" } as WorkerResponse);
        return;
      }
      const result = this.engine.queryRows(
        (msg as { tab: "iml" | "events" }).tab,
        (msg as { filter: { severity: "all" | "critical" | "warning" | "information"; text: string } }).filter,
        (msg as { page: number }).page
      );
      this.post({ id, ok: true, type: "query", result } as WorkerResponse);
    } else if (msg.type === "export") {
      if (!this.model) {
        this.post({ id, ok: false, type: "export", error: "No analysis loaded" } as WorkerResponse);
        return;
      }
      // minimal stand-in for the PDF protocol (bytes, %PDF marker)
      this.post({
        id,
        ok: true,
        type: "export",
        pdf: new TextEncoder().encode("%PDF-1.7 fake report"),
      } as WorkerResponse);
    }
  }
}

function bytesToFile(buffer: Uint8Array, name = "test.ahs") {
  return new File([buffer.buffer as ArrayBuffer], name, {
    type: "application/octet-stream",
  });
}

async function buildSyntheticFile() {
  const records = [
    await buildRecord("CUST_INFO.DAT", u8concat(
      (() => { const b = new Uint8Array(15); b.set(te.encode("CASE-9"), 0); return b; })(),
      new Uint8Array(256),
      new Uint8Array(40),
      new Uint8Array(256),
      new Uint8Array(256)
    )),
    await buildRecord("0000001-2024-01-01.zbb", u8concat(
      buildLogRecord({ type: 0x0b, classCode: 0x000a, eventCode: 0x0469, date: "11/12/2024 21:30:24", id: 1, message: "Uncorrectable Error Detected (Processor 1). ACTION: Check the processor." }),
      new Uint8Array([0x00, 0x7e]),
      buildLogRecord({ type: 0x0c, classCode: 0, eventCode: 0, date: "11/12/2024 21:31:00", id: 2, message: "Server reset." }),
      new Uint8Array([0x00, 0x7e]),
      buildLogRecord({ type: 0x0b, classCode: 0x000a, eventCode: 0x0500, date: "11/12/2024 21:32:00", id: 3, message: "Informational entry." })
    ), { gzip: true }),
  ];
  return bytesToFile(u8concat(...records));
}

describe("AnalyzerClient RPC protocol", () => {
  let RealWorker: typeof Worker;
  beforeEach(() => {
    RealWorker = globalThis.Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorkerImpl;
  });
  afterEach(() => {
    (globalThis as { Worker: unknown }).Worker = RealWorker;
    lastWorker = null;
  });

  it("analyze resolves a summary without iml/events and reports progress", async () => {
    const client = new AnalyzerClient();
    const file = await buildSyntheticFile();
    const progress: number[] = [];
    const { summary, fingerprint, fromCache } = await client.analyze(file, (p) =>
      progress.push(p.pct)
    );
    expect(progress.length).toBeGreaterThan(0);
    expect(summary.stats.imlCount).toBe(2);
    expect(summary.stats.eventCount).toBe(1);
    expect((summary as unknown as Record<string, unknown>).iml).toBeUndefined();
    expect((summary as unknown as Record<string, unknown>).events).toBeUndefined();
    expect(summary.customerInfo?.caseNumber).toBe("CASE-9");
    expect(fingerprint).toBe("fp-test");
    expect(fromCache).toBe(false);
    client.cancel();
  });

  it("query pages IML rows through the worker protocol", async () => {
    const client = new AnalyzerClient();
    const file = await buildSyntheticFile();
    await client.analyze(file, () => {});
    const res = await client.query("iml", { severity: "all", text: "" }, 0);
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(2);
    // IML arrives newest-first: the informational entry (21:32) precedes the
    // uncorrectable error (21:30).
    expect(res.rows[0].message).toContain("Informational entry.");
    expect(res.rows.some((r) => r.message.includes("Uncorrectable Error Detected"))).toBe(true);
    const crit = await client.query("iml", { severity: "critical", text: "" }, 0);
    expect(crit.total).toBe(1);
    expect(crit.rows[0].message).toContain("Uncorrectable Error Detected");
    client.cancel();
  });

  it("query fails cleanly before any analysis", async () => {
    const client = new AnalyzerClient();
    await expect(client.query("iml", { severity: "all", text: "" }, 0)).rejects.toThrow(
      /no analysis/i
    );
    client.cancel();
  });

  it("export returns the PDF report bytes", async () => {
    const client = new AnalyzerClient();
    const file = await buildSyntheticFile();
    await client.analyze(file, () => {});
    const pdf = await client.exportReport();
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF")).toBe(true);
    client.cancel();
  });

  it("cancel terminates the worker and rejects the pending analyze", async () => {
    const client = new AnalyzerClient();
    const file = await buildSyntheticFile();
    const pending = client.analyze(file, () => {});
    client.cancel();
    expect(lastWorker?.terminated).toBe(true);
    await expect(pending).rejects.toThrow(/cancelled/i);
  });
});
