import { describe, it, expect } from "vitest";
import { normalizeCriticalAlarm, extractComponent } from "../../domain/usecases/iml-rca.js";

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
