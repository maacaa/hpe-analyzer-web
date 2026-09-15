import { describe, it, expect } from "vitest";
import { resolveSeverity } from "../../adapters/kb/iml-codes.js";
import { splitAction, imlDocUrl, heuristicSeverity } from "../../domain/services/iml-format.js";

describe("resolveSeverity", () => {
  it("maps known critical codes to critical", () => {
    expect(resolveSeverity(0x0a, 0x0469, "Uncorrectable Error")).toBe("critical");
    expect(resolveSeverity(0x32, 0x3013, "Processor BIST Failure")).toBe("critical");
  });

  it("classifies Link Failure as information (explicit rule)", () => {
    expect(
      resolveSeverity(0, 0, "Network ... status changed to Link Failure ...")
    ).toBe("information");
  });

  it("falls back to heuristic for unknown codes", () => {
    expect(resolveSeverity(0, 0, "Uncorrectable Machine Check Exception")).toBe(
      "critical"
    );
    expect(resolveSeverity(0, 0, "System is at Risk")).toBe("warning");
    expect(resolveSeverity(0, 0, "Server reset.")).toBe("information");
  });

  it("classifies Firmware flashed as information, not critical (regression)", () => {
    expect(resolveSeverity(0x20, 0x0002, "Firmware flashed (iLO 5 2.65)")).toBe(
      "information"
    );
    expect(resolveSeverity(0x20, 0x0002, "Firmware flashed (System BIOS - U32 v2.62)")).toBe(
      "information"
    );
  });

  it("classifies Uncorrectable Memory Error as critical", () => {
    expect(
      resolveSeverity(0x32, 0x0462, "Uncorrectable Memory Error Threshold Exceeded (Processor 1, DIMM 10)")
    ).toBe("critical");
  });

  it("classifies DIMM mapped out as warning", () => {
    expect(
      resolveSeverity(0x0a, 0x0511, "One or more DIMMs have been mapped out due to a memory error")
    ).toBe("warning");
  });
});

describe("splitAction", () => {
  it("splits alarm from ACTION resolution", () => {
    const { alarm, resolution } = splitAction(
      "Processor failure. ACTION: Reset the system."
    );
    expect(alarm).toBe("Processor failure.");
    expect(resolution).toBe("Reset the system.");
  });

  it("returns null resolution when no ACTION", () => {
    const { resolution } = splitAction("Just a message.");
    expect(resolution).toBeNull();
  });
});

describe("imlDocUrl", () => {
  it("formats the official doc URL", () => {
    const url = imlDocUrl(0x0a, 0x0469);
    expect(url).toContain("class0x000acode0x0469");
    expect(url).toContain("ilogen12-msg-en_us");
  });
});
