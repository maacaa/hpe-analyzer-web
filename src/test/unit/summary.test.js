import { describe, it, expect } from "vitest";
import { buildSummary } from "../../summary.js";
import { makeModel } from "../fixtures.js";

describe("buildSummary", () => {
  const model = makeModel({
    meta: {
      sourceFile: "x.ahs",
      productName: "ProLiant DL360 Gen10",
      serialNumber: "ABC123",
      productId: "869121-B21",
      orderNumber: "ORD-1",
    },
    firmware: [{ component: "System ROM", version: "2.34", category: "ROM", source: "zbb" }],
    hardware: [
      { type: "power-supply", slot: "Power Supply 1", status: "failed", source: "bcert" },
    ],
    rca: [
      {
        title: "Uncorrectable machine check exception",
        components: ["Processor 2"],
        resolution: "Update the firmware.",
        severity: "critical",
        classCode: 0x05,
        eventCode: 0x03,
        docUrl: "x",
        count: 3,
        lastDate: "01/02/2024 03:04:05",
        lastTimestamp: 1,
        bugs: [],
      },
    ],
    advisories: [
      {
        id: "a1",
        title: "False errors",
        description: "desc",
        component: "System ROM",
        affectedVersions: {},
        fixedIn: "2.35",
        severity: "warning",
        resolvesErrorCodes: [],
        results: [{ component: "System ROM", version: "2.34", affected: true, label: "AFFECTED", fix: "Update" }],
      },
    ],
  });

  it("includes server identity and stats", () => {
    const s = buildSummary(model);
    expect(s).toContain("ProLiant DL360 Gen10");
    expect(s).toContain("ABC123");
    expect(s).toContain("Critical");
    expect(s).toContain("RCA groups");
  });

  it("includes firmware, hardware health and RCA", () => {
    const s = buildSummary(model);
    expect(s).toContain("System ROM = 2.34");
    expect(s).toContain("Power Supply 1 [failed]");
    expect(s).toContain("Uncorrectable machine check exception (x3)");
    expect(s).toContain("resolution: Update the firmware.");
  });

  it("includes advisories status", () => {
    const s = buildSummary(model);
    expect(s).toContain("False errors");
    expect(s).toContain("AFFECTED");
  });
});