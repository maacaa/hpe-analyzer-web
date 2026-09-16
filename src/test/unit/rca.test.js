import { describe, it, expect } from "vitest";
import { normalizeCriticalAlarm, extractComponent } from "../../domain/usecases/iml-rca.js";
import { buildPlaybook } from "../../domain/services/critical-playbook.js";

describe("normalizeCriticalAlarm", () => {
  it("extracts a stable title from a component-specific message", () => {
    const a = normalizeCriticalAlarm(
      "Uncorrectable Machine Check Exception (Processor 2, APIC ID 0x00000056, Bank 0x0)"
    );
    expect(a.title).toBe("Uncorrectable Machine Check Exception");
    expect(a.component).toBe("Processor 2");
  });

  it("extracts title and DIMM component for memory errors", () => {
    const a = normalizeCriticalAlarm(
      "Uncorrectable Memory Error Threshold Exceeded (Processor 1, DIMM 10).  The DIMM is mapped out"
    );
    expect(a.title).toBe("Uncorrectable Memory Error Threshold Exceeded");
    expect(a.component).toBe("Processor 1 · DIMM 10");
  });

  it("extracts Processor component when not in parentheses (BIST)", () => {
    const a = normalizeCriticalAlarm(
      "Processor Built-In Self-Test (BIST) Failure.  Processor 0, Error Code : 0xFFFFFFFF"
    );
    expect(a.title).toBe("Processor Built-In Self-Test (BIST) Failure");
    expect(a.component).toBe("Processor 0");
  });
});

describe("extractComponent", () => {
  it("returns empty for messages without a hardware component", () => {
    expect(
      extractComponent("Uncorrectable Error Detected on the Previous Boot. Error info logged.")
    ).toBe("");
  });

  it("ignores APIC/Bank/Segment details", () => {
    expect(
      extractComponent("X (Processor 2, APIC ID 0x40, Bank 0x1)")
    ).toBe("Processor 2");
  });
});

describe("buildPlaybook", () => {
  it("always returns a meaning and ordered steps", () => {
    for (const cat of [
      "pcie",
      "memory",
      "processor",
      "cooling",
      "power",
      "storage",
      "network",
      "security",
      "ilo",
      "firmware",
      "system",
      null,
    ]) {
      const pb = buildPlaybook("Some message", "Some title", cat);
      expect(pb.meaning.length).toBeGreaterThan(40);
      expect(pb.steps.length).toBeGreaterThan(2);
      expect(pb.steps.some((s) => s.length > 10)).toBe(true);
    }
  });

  it("decodes PCIe bus/device/function and error status bits", () => {
    const pb = buildPlaybook(
      "Uncorrectable PCI Express Error Detected. PCIe Errors (Segment 0x0, Bus 0x61, Device 0x0, Function 0x0). Uncorrectable Error Status: 0x150000",
      "Uncorrectable PCI Express Error Detected",
      "pcie"
    );
    const bus = pb.details?.find((d) => d.label.includes("endpoint"));
    expect(bus?.value).toContain("0x61");
    const status = pb.details?.find((d) => d.label.includes("Status"));
    expect(status?.value).toContain("Completion Timeout");
    expect(status?.value).toContain("0x150000");
  });

  it("flags reported DIMMs in memory events", () => {
    const pb = buildPlaybook(
      "Uncorrectable Memory Error Threshold Exceeded (Processor 1, DIMM 10)",
      "Uncorrectable Memory Error Threshold Exceeded",
      "memory"
    );
    expect(pb.details?.[0].value).toContain("DIMM 10");
  });
});
