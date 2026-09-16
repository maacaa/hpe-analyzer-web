// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "../../App";
import { makeModel } from "../fixtures";
import type { AnalyzerClient } from "../../api/worker-client";
import type { LogQueryResult, Summary } from "../../types";

const model = makeModel({
  firmware: [
    {
      component: "System CPLD",
      version: "0x30",
      displayVersion: "0x30",
      category: "CPLD",
      date: null,
      format: "hex",
      source: "bcert.pkg",
    },
  ],
  hardware: [{ type: "cpu", model: "AMD EPYC 7513", cores: "32", source: "bcert.pkg" }],
  iml: [
    {
      date: "01/02/2024 03:04:05",
      id: 1,
      classCode: 0,
      eventCode: 0,
      logType: "iml",
      severity: "critical",
      message: "Processor BIST Failure",
      alarm: "Processor BIST Failure",
      resolution: "Reset the system.",
      timestamp: 1,
      source: "test.zbb",
    },
  ],
  rca: [
    {
      title: "Processor Built-In Self-Test (BIST) Failure",
      components: ["Processor 0"],
      resolution: "Reset the system.",
      bugs: [],
      severity: "critical",
      classCode: 0x32,
      eventCode: 0x3013,
      docUrl: "https://support.hpe.com",
      count: 1,
      lastDate: "01/02/2024 03:04:05",
      lastTimestamp: 1,
    },
  ],
  stats: {
    records: 1,
    zbbFiles: 1,
    imlCount: 1,
    eventCount: 0,
    criticalCount: 1,
    warningCount: 0,
  },
});

function fakeRpcClient(): AnalyzerClient {
  const { iml: _iml, events: _events, ...summary } = model;
  return {
    analyze: vi.fn((_file: File, onProgress?: (p: unknown) => void) => {
      onProgress?.({ phase: "x.zbb", done: 1, total: 2, pct: 50 });
      return Promise.resolve({
        summary: summary as unknown as Summary,
        fingerprint: "fp-1",
        fromCache: false,
      });
    }),
    openCached: vi.fn(async (fingerprint: string) => {
      if (fingerprint === "fp-1") {
        return { summary: summary as unknown as Summary, fingerprint, fromCache: true };
      }
      throw new Error("Cached analysis not found. Analyze the file again.");
    }),
    query: vi.fn(async (): Promise<LogQueryResult> => ({ rows: [], total: 0 })),
    exportReport: vi.fn(async () => "HPE AHS Analyzer - Analysis report"),
    cancel: vi.fn(),
  } as unknown as AnalyzerClient;
}

function triggerFileAnalysis() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["dummy"], "test.ahs", { type: "application/octet-stream" });
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);
}

async function runAnalysis() {
  const client = fakeRpcClient();
  render(<App client={client} />);
  await screen.findByText(/Drop an AHS file here/);
  fireEvent.click(screen.getByRole("button", { name: /browse files/i }));
  await act(async () => {
    triggerFileAnalysis();
  });
  await screen.findByText("Firmware");
  return client;
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts at the drop zone", async () => {
    render(<App client={fakeRpcClient()} />);
    expect(await screen.findByText(/Drop an AHS file here/)).toBeInTheDocument();
  });

  it("shows the Create HPE case link pointing to the support center", async () => {
    render(<App client={fakeRpcClient()} />);
    const link = await screen.findByRole("link", { name: /create hpe case/i });
    expect(link).toHaveAttribute(
      "href",
      "https://support.hpe.com/connect/s/createcase?client=home"
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("keeps the Create HPE case link visible after analysis", async () => {
    await runAnalysis();
    expect(screen.getByRole("link", { name: /create hpe case/i })).toBeInTheDocument();
  });

  it("shows tabs after analysis", async () => {
    await runAnalysis();
    for (const t of ["Firmware", "Hardware", "IML Logs", "Event Logs", "RCA"]) {
      expect(screen.getByRole("button", { name: new RegExp(t) })).toBeInTheDocument();
    }
  });

  it("auto-selects the RCA tab when critical events exist", async () => {
    await runAnalysis();
    expect(screen.getByText(/Reset the system/)).toBeInTheDocument();
  });

  it("switches tab content when a tab is clicked", async () => {
    await runAnalysis();
    fireEvent.click(screen.getByRole("button", { name: /Hardware/ }));
    expect(screen.getByText("AMD EPYC 7513")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Firmware/ }));
    expect(screen.getByText("System CPLD")).toBeInTheDocument();
  });

  it("shows the Analyze another AHS file button and opens the upload overlay", async () => {
    const client = await runAnalysis();
    fireEvent.click(screen.getByRole("button", { name: /analyze another ahs file/i }));
    expect(screen.getByText("Analyze AHS file")).toBeInTheDocument();
    // Escape closes the overlay and keeps the current analysis intact
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("Analyze AHS file").closest('[data-open]')).toHaveAttribute("data-open", "false");
    expect(client.cancel).not.toHaveBeenCalled();
  });

  it("shows the export report button in the topbar after analysis", async () => {
    await runAnalysis();
    expect(screen.getByRole("button", { name: /export report/i })).toBeInTheDocument();
  });

  it("adds the analyzed file to the recents list and reopens it from cache", async () => {
    const client = await runAnalysis();
    fireEvent.click(screen.getByRole("button", { name: /analyze another ahs file/i }));
    const item = await screen.findByRole("button", { name: "test.ahs" });
    // reopen from the local cache (RF-7/RF-12)
    fireEvent.click(item);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /analyze another ahs file/i })).toBeInTheDocument()
    );
    expect(client.openCached).toHaveBeenCalledWith("fp-1");
    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });

  it("exposes a Cancel button while loading that terminates the worker", async () => {
    const client = fakeRpcClient();
    (client.analyze as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    render(<App client={client} />);
    await screen.findByText(/Drop an AHS file here/);
    fireEvent.click(screen.getByRole("button", { name: /browse files/i }));
    await act(async () => {
      triggerFileAnalysis();
    });
    const cancel = await screen.findByRole("button", { name: /cancel/i });
    fireEvent.click(cancel);
    expect(client.cancel).toHaveBeenCalled();
    expect(await screen.findByText(/Drop an AHS file here/)).toBeInTheDocument();
  });
});
