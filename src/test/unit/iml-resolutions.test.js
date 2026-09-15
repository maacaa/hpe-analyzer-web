import { describe, it, expect } from "vitest";
import { resolveRcaError, IML_RESOLUTIONS } from "../../adapters/kb/iml-resolutions.js";

describe("resolveRcaError", () => {
  it("returns an in-app resolution for Uncorrectable Memory Error", () => {
    const r = resolveRcaError(0x32, 0x0462, "Uncorrectable Memory Error Threshold Exceeded");
    expect(r.resolution).toMatch(/replace the failing DIMM/i);
  });

  it("returns resolution for Machine Check Exception", () => {
    const r = resolveRcaError(0x0005, 0x0003, "Uncorrectable Machine Check Exception");
    expect(r.resolution).toMatch(/Update the system firmware/i);
  });

  it("returns resolution for PCI Express Error", () => {
    const r = resolveRcaError(0x0008, 0x0002, "Uncorrectable PCI Express Error");
    expect(r.resolution).toMatch(/Update the firmware to the latest version/i);
  });

  it("falls back to the message ACTION text for unknown codes", () => {
    const r = resolveRcaError(
      0x9999,
      0x9999,
      "Some unknown critical error. ACTION: Do something specific."
    );
    expect(r.resolution).toBe("Do something specific.");
  });

  it("has a populated resolution database", () => {
    expect(Object.keys(IML_RESOLUTIONS).length).toBeGreaterThanOrEqual(5);
  });

  it("provides human-readable titles (no hex codes)", () => {
    for (const key of Object.keys(IML_RESOLUTIONS)) {
      const e = IML_RESOLUTIONS[key];
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.title).not.toMatch(/\b0x[0-9a-f]{3,}\b/i);
      expect(e.resolution.length).toBeGreaterThan(0);
    }
  });

  it("covers every critical code observed in the real samples", () => {
    // Codes discovered by sweeping all AHS samples (see crit-codes sweep).
    const observed = [
      "0005|0003",
      "0008|0002",
      "000a|0467",
      "000a|0469",
      "0023|044e",
      "0032|0462",
      "0032|3013",
    ];
    for (const code of observed) {
      expect(IML_RESOLUTIONS[code], `missing resolution for ${code}`).toBeDefined();
    }
  });
});
