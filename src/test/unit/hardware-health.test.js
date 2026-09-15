// @ts-check
// Tests for the hardware health use case: per-component exact IML alarms
// (`issues`) and the enriched system-board entry.
import { describe, it, expect } from "vitest";
import { enrichHardware } from "../../domain/usecases/hardware-health.js";

function entry(overrides = {}) {
  const out = {
    date: "01/02/2024 03:04:05",
    id: 1,
    classCode: 0,
    eventCode: 0,
    logType: "iml",
    severity: "information",
    message: "note",
    alarm: "note",
    resolution: null,
    timestamp: 1,
    source: "zbb",
    ...overrides,
  };
  // the health predicates run on e.message
  if (overrides.alarm && !overrides.message) out.message = overrides.alarm;
  return out;
}

describe("enrichHardware: issues", () => {
  it("attaches the exact alarms that drive a component to failed", () => {
    const hardware = [{ type: "memory", id: "10", model: "DIMM,8GB", slot: "DIMM 10", source: "bcert" }];
    const iml = [
      entry({ severity: "information", alarm: "System reset." }),
      entry({
        severity: "critical",
        alarm: "Uncorrectable Memory Error Threshold Exceeded (Processor 1, DIMM 10)",
        date: "03/04/2024 10:00:00",
      }),
      entry({
        severity: "warning",
        alarm: "Correctable memory errors (DIMM 10)",
        date: "03/04/2024 11:00:00",
      }),
    ];

    enrichHardware(hardware, iml, {}, []);

    expect(hardware[0].status).toBe("failed");
    // both alarms affected this DIMM: critical duplicate + correctable warning
    expect(hardware[0].issues).toHaveLength(2);
    expect(hardware[0].issues[0].message).toBe("Uncorrectable Memory Error Threshold Exceeded (Processor 1, DIMM 10)");
    expect(hardware[0].issues[0].date).toBe("03/04/2024 10:00:00");
    expect(hardware[0].issues[0].severity).toBe("critical");
  });

  it("caps the issue list at 5 deduplicated alarms, newest first", () => {
    const hardware = [{ type: "fan", slot: "Fan 1", source: "bcert" }];
    // IML arrives newest-first everywhere else in the pipeline
    const iml = [];
    for (let i = 7; i >= 0; i--) {
      iml.push(entry({
        severity: "warning",
        alarm: `Fan 1 redundancy lost, variant ${i}`,
        date: `0${(i % 9) + 1}/02/2024 1${i}:00:00`,
      }));
    }

    enrichHardware(hardware, iml, {}, []);

    expect(hardware[0].status).toBe("warning");
    expect(hardware[0].issues).toHaveLength(5);
    expect(hardware[0].issues[0].message).toContain("variant 7");
    expect(new Set(hardware[0].issues.map((i) => i.message)).size).toBe(5);
  });

  it("healthy components get no issues", () => {
    const hardware = [{ type: "cpu", id: "1", model: "X", source: "bcert" }];
    const iml = [entry({ severity: "critical", alarm: "DIMM problem (DIMM 4)" })];

    enrichHardware(hardware, iml, {}, []);

    expect(hardware[0].status).toBe("healthy");
    expect(hardware[0].issues).toBeUndefined();
  });

  it("network adapters: no health status and no issues (user exception)", () => {
    const hardware = [
      { type: "network-controller", id: "3", slot: "Slot 1", model: "331i", source: "bcert" },
    ];
    const iml = [
      entry({
        severity: "warning",
        alarm: "Network adapter Slot 1 link down detected (NIC)",
      }),
      entry({
        severity: "critical",
        alarm: "Uncorrectable network adapter error on Slot 1 (NIC)",
      }),
    ];

    enrichHardware(hardware, iml, {}, []);

    expect(hardware[0].status).toBeUndefined();
    expect(hardware[0].issues).toBeUndefined();
  });
});

describe("enrichHardware system-board", () => {
  const firmware = [
    { component: "System ROM", version: "2.64" },
    { component: "iLO (Lights-Out Management)", version: "2.16" },
    { component: "BMC", version: "1.05" },
    { component: "System CPLD", version: "0x30" },
  ];

  it("carries the full board identity, versions and total memory", () => {
    const target = [];
    const meta = {
      productName: "ProLiant DL360 Gen10",
      serialNumber: "CZ123",
      productId: "869121-B21",
      orderNumber: "ORD-9",
      manufacturer: "HPE",
      skuNumber: "SKU-1",
      totalSystemMemory: "196 GB",
    };
    enrichHardware(target, [], meta, firmware);

    const board = target.find((h) => h.type === "system-board");
    expect(board.model).toBe("ProLiant DL360 Gen10");
    expect(board.serialNumber).toBe("CZ123");
    expect(board.partNumber).toBe("869121-B21");
    expect(board.totalSystemMemory).toBe("196 GB");
    expect(board.systemRomVersion).toBe("2.64");
    expect(board.iloVersion).toBe("2.16");
    expect(board.bmcVersion).toBe("1.05");
    expect(board.cpldVersion).toBe("0x30");
  });

  it("is created only when the product name exists", () => {
    const target = [];
    enrichHardware(target, [], {}, []);
    expect(target).toHaveLength(0);
  });
});
