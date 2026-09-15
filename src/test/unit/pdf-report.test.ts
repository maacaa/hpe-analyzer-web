// @vitest-environment node
// PDF report builder test (RNF: jsPDF is pure JS, runs everywhere).
import { describe, it, expect } from "vitest";
import { buildPdfReport } from "../../worker/pdf-report.js";
import { makeModel } from "../fixtures.js";

function buildSummaryFixture() {
  const model = makeModel({
    meta: {
      sourceFile: "x.ahs",
      productName: "ProLiant DL360 Gen10",
      serialNumber: "ABC123",
      productId: "869121-B21",
      orderNumber: "ORD-1",
      totalSystemMemory: "196 GB",
    },
    firmware: [
      {
        component: "System CPLD",
        version: "0x30",
        displayVersion: "0x30",
        category: "CPLD",
        date: null,
        format: "hex",
        description: "Complex Programmable Logic Device.",
        source: "bcert.pkg",
      },
      {
        component: "iLO (Lights-Out Management)",
        version: "2.16",
        displayVersion: "2.16",
        category: "iLO",
        date: "05/13/2020",
        format: "decimal",
        source: "zbb",
      },
    ],
    hardware: [
      {
        type: "power-supply",
        slot: "Power Supply 1",
        status: "failed",
        source: "bcert",
        issues: [
          {
            date: "03/04/2024 10:00:00",
            severity: "critical",
            message: "Input voltage insufficient for redundant power supplies",
          },
        ],
      },
      {
        type: "system-board",
        model: "ProLiant DL360 Gen10",
        serialNumber: "ABC123",
        totalSystemMemory: "196 GB",
        systemRomVersion: "2.64",
        iloVersion: "2.16",
        source: "bcert",
      },
    ],
    rca: [
      {
        title: "Uncorrectable machine check exception",
        components: ["Processor 2"],
        resolution: "Update the firmware.",
        cause: "Processor errata.",
        severity: "critical",
        classCode: 0x05,
        eventCode: 0x03,
        docUrl: "https://support.hpe.com/x",
        count: 3,
        lastDate: "01/02/2024 03:04:05",
        lastTimestamp: 1,
        bugs: [
          {
            id: "a00117806en_us",
            title: "False Uncorrectable Memory Errors after System ROM 2.50",
            description: "A firmware fault causes false errors.",
            component: "System ROM",
            affectedVersions: { min: "2.50", max: "2.53" },
            fixedIn: "2.54",
            severity: "critical",
            results: [
              {
                component: "System ROM (family U32)",
                version: "2.50",
                affected: true,
                label: "System ROM 2.50 is AFFECTED by this known issue.",
                fix: "Update System ROM to 2.54 or later.",
              },
            ],
          },
        ],
      },
    ],
    advisories: [
      {
        id: "adv-1",
        title: "P408i-a data inconsistency with Smart Array",
        description: "Data inconsistency during heavy load.",
        component: "Storage controller",
        affectedVersions: { max: "2.61" },
        fixedIn: "2.62",
        severity: "warning",
        resolvesErrorCodes: [],
        results: [
          {
            component: "HPE Smart Array P408i-a",
            version: "2.50",
            affected: true,
            label: "affected",
            fix: "Update to 2.62 or later.",
          },
        ],
      },
    ],
  });
  const { iml: _i, events: _e, ...summary } = model;
  return summary;
}

describe("buildPdfReport", () => {
  it("generates a valid multi-section PDF", async () => {
    const { pdf, pages } = await buildPdfReport(buildSummaryFixture(), "x.ahs");
    const head = pdf.subarray(0, 5);
    expect(String.fromCharCode(...head)).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    expect(pages).toBeGreaterThanOrEqual(1);
  });

  it("is page-aware (long content grows the document)", async () => {
    const s = buildSummaryFixture();
    s.hardware = Array.from({ length: 60 }, (_, i) => ({
      type: "memory",
      id: String(i + 1),
      model: `DIMM,64GB unit ${i}`,
      slot: `DIMM ${i + 1}`,
      status: "warning",
      issues: Array.from({ length: 5 }, (_, j) => ({
        date: `01/02/2024 10:0${j}:00`,
        severity: "warning",
        message: `Correctable memory error threshold exceeded on DIMM ${i + 1} (issue ${j})`,
      })),
      source: "bcert",
    }));
    const { pages, pdf } = await buildPdfReport(s, "x.ahs");
    expect(pages).toBeGreaterThan(1);
    expect(String.fromCharCode(...pdf.subarray(0, 5))).toBe("%PDF-");
  });

  it("handles an almost-empty summary", async () => {
    const s = {
      meta: { sourceFile: "empty.ahs" },
      customerInfo: null,
      fileListing: [],
      clist: [],
      counters: [],
      firmware: [],
      hardware: [],
      rca: [],
      advisories: [],
      stats: {
        records: 0,
        zbbFiles: 0,
        imlCount: 0,
        eventCount: 0,
        criticalCount: 0,
        warningCount: 0,
      },
    };
    const { pdf } = await buildPdfReport(s, "empty.ahs");
    expect(String.fromCharCode(...pdf.subarray(0, 5))).toBe("%PDF-");
  });
});
