// @vitest-environment node
// Real-file regression (serial-number fix, plan approved 2026-09-14 v3):
// meta.serialNumber must equal the unit serial embedded in the file name
// (HPE_<SN>_<date>.ahs) for our sample set.  Files must live in "AHS files/".
import { describe, it, expect } from "vitest";
import { analyzeWebStreaming } from "../../adapters/delivery/analyzer-stream.js";
import { analyzeWeb } from "../../adapters/delivery/analyzer-web.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const AHS_DIR = path.join(ROOT, "AHS files");

const SAMPLES = [
  "HPE_SGH202W6ZR_20260907.ahs",      // regression: no DiagProcess; PCA serial must NOT leak
  "HPE_SGH029VB8P_20240710.ahs",      // normal MfgRecord path
  "HPE_CZUD3M01TD_20260831.ahs",      // DiagProcess present but SerialNumber empty
  "HPE_CZ22040HHJ_19700117.ahs",      // classic CZ unit
];

function expectedSerial(name: string): string | null {
  const m = /HPE_([A-Z0-9]{9,12})_/.exec(name);
  return m ? m[1] : null;
}

async function analyzeFile(name: string) {
  const f = path.join(AHS_DIR, name);
  if (!fs.existsSync(f)) return null;
  const buf = fs.readFileSync(f);
  const file = new File([buf], name, { type: "application/octet-stream" });
  return analyzeWebStreaming(file);
}

describe("unit serial regression (filename == meta.serialNumber)", () => {
  for (const name of SAMPLES) {
    it(`reports the unit serial for ${name}`, { timeout: 600_000 }, async () => {
      const expected = expectedSerial(name);
      if (!expected) throw new Error(`cannot parse SN from ${name}`);
      const model = await analyzeFile(name);
      if (!model) return; // file not present in this checkout
      expect(model.meta.serialNumber).toBe(expected);
      // the fabrication PCB serial must never surface as the unit serial
      expect(model.meta.serialNumber).not.toBe(model.meta.pcaSerialNumber);
    });
  }

  it("streaming and whole-record paths agree on the serial (SGH202W6ZR)", { timeout: 600_000 }, async () => {
    const name = "HPE_SGH202W6ZR_20260907.ahs";
    const f = path.join(AHS_DIR, name);
    if (!fs.existsSync(f)) return;
    const buf = fs.readFileSync(f);
    const file = new File([buf], name, { type: "application/octet-stream" });
    const [a, b] = await Promise.all([
      analyzeWebStreaming(file),
      analyzeWeb(file),
    ]);
    expect(a.meta.serialNumber).toBe("SGH202W6ZR");
    expect(b.meta.serialNumber).toBe("SGH202W6ZR");
    expect(a.meta.productId).toBe(b.meta.productId);
  });
});
