// @vitest-environment node
// Streaming equivalence tests (Fase 1): analyzeWebStreaming must produce the
// same Model as the whole-record analyzeWeb path, both on synthetic fixtures
// with records larger than the read chunk and on real AHS samples.
import { describe, it, expect } from "vitest";
import { analyzeWeb } from "../../adapters/delivery/analyzer-web.js";
import { analyzeWebStreaming } from "../../adapters/delivery/analyzer-stream.js";
import { buildRecord, buildLogRecord, str0, u8concat } from "../helpers.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const te = new TextEncoder();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const AHS_DIR = path.join(ROOT, "AHS files");

function bytesToFile(buffer, name = "test.ahs") {
  return new File([buffer], name, { type: "application/octet-stream" });
}

function buildInlineRecord(name, value) {
  const header = new Uint8Array([0x18, 0x0d, 0x04, name.length + 4, 0x00]);
  return u8concat(
    header,
    te.encode(name),
    new Uint8Array([0]),
    te.encode(value),
    new Uint8Array([0])
  );
}

/** zbb payload with entries + inline records + firmware strings (record > chunk). */
function buildZbbPayload(entryCount = 40) {
  const parts = [te.encode("ZBB-HEADER junk 0123456789 ")];
  for (let i = 0; i < entryCount; i++) {
    parts.push(new Uint8Array([0x00, 0x7e, 0x41, 0x42, 0x00]));
    parts.push(
      buildLogRecord({
        type: i % 3 === 0 ? 0x0c : 0x0b,
        classCode: 0x000a + (i % 4),
        eventCode: 0x0400 + i,
        date: `0${(i % 9) + 1}/1${i % 3}/2024 ${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`,
        id: i + 1,
        message: i % 5 === 0
          ? `Uncorrectable Machine Check Exception (Processor ${i % 3 + 1}, APIC ID 0x${i}). ACTION: Check the processor.`
          : `Informational message number ${i}. ACTION: None.`,
      })
    );
  }
  parts.push(new Uint8Array([0x00, 0x7e]));
  parts.push(buildInlineRecord("PowerManagementFirmware", "1.2.3"));
  parts.push(new Uint8Array([0x00, 0x7e]));
  parts.push(te.encode("System ROM\x00v2.34 some trailing text\x00"));
  parts.push(te.encode("iLO 5 v2.16p07 built on Jun 24 2020\x00"));
  return u8concat(...parts);
}

async function buildSyntheticFile() {
  const bcertXml =
    "<BC><MfgRecord><DiagProcess><SerialNumber>SYN123</SerialNumber>" +
    "<ProductName>ProLiant DL380 Gen10</ProductName></DiagProcess></MfgRecord></BC>";
  const records = [
    await buildRecord("CUST_INFO.DAT", u8concat(
      str0("CASE-1", 15),
      str0("Jane", 256),
      str0("555", 40),
      str0("j@x.com", 256),
      str0("ACME", 256)
    )),
    await buildRecord("bcert.pkg", te.encode(bcertXml), { gzip: true }),
    await buildRecord("0000001-2024-01-01.zbb", buildZbbPayload(), { gzip: true }),
    await buildRecord("file.pkg", te.encode("a.log\nb.log")),
  ];
  return bytesToFile(u8concat(...records), "synthetic.ahs");
}

function comparableModel(m) {
  return {
    stats: m.stats,
    meta: m.meta,
    customerInfo: m.customerInfo,
    firmware: m.firmware,
    hardware: m.hardware,
    iml: m.iml,
    events: m.events,
    rca: m.rca.map((r) => ({ title: r.title, count: r.count, severity: r.severity })),
    advisories: m.advisories,
  };
}

describe("analyzeWebStreaming vs analyzeWeb (synthetic, record > chunk)", () => {
  it("produces an identical Model with a tiny batch size", async () => {
    const file = await buildSyntheticFile();
    const whole = await analyzeWeb(file);
    const streamed = await analyzeWebStreaming(file, null, { batchBytes: 64 });
    expect(comparableModel(streamed)).toEqual(comparableModel(whole));
    // sanity: the zbb record (several KB) was decompressed through 64-byte batches
    expect(streamed.stats.zbbFiles).toBe(1);
    expect(streamed.stats.imlCount).toBeGreaterThan(0);
  });

  it("reports progress up to the file size", async () => {
    const file = await buildSyntheticFile();
    const calls = [];
    await analyzeWebStreaming(file, (p) => calls.push(p), { batchBytes: 128 });
    const last = calls[calls.length - 1];
    expect(last.done).toBe(file.size);
    expect(last.pct).toBe(100);
    expect(calls.every((c) => c.total === file.size)).toBe(true);
  });

  it("drops an over-limit zbb record atomically and keeps parsing", async () => {
    const file = await buildSyntheticFile();
    const whole = await analyzeWebStreaming(file, null, { maxDecompressed: 100 });
    expect(whole.stats.zbbFiles).toBe(0);
    expect(whole.iml).toHaveLength(0);
    expect(whole.customerInfo.caseNumber).toBe("CASE-1"); // later record still parsed
    expect(whole.stats.records).toBe(4);
  });

  it("enforces the total decompressed cap across records", async () => {
    const file = await buildSyntheticFile();
    const m = await analyzeWebStreaming(file, null, { maxTotalDecompressed: 500 });
    // bcert.pkg (~a few hundred bytes decompressed) and the zbb record both
    // exceed the tiny budget and are dropped; raw records still parse.
    expect(m.stats.zbbFiles).toBe(0);
    expect(m.customerInfo.caseNumber).toBe("CASE-1");
    expect(m.stats.records).toBe(4);
  });
});

describe("analyzeWebStreaming vs analyzeWeb (real AHS samples)", () => {
  const SAMPLES = [
    "HPE_SGH029VB8P_20240710.ahs",
    "HPE_CZ22040HHJ_19700106.ahs",
  ];

  for (const name of SAMPLES) {
    it(`produces an identical Model for ${name}`, async () => {
      const f = path.join(AHS_DIR, name);
      if (!fs.existsSync(f)) return;
      const buf = fs.readFileSync(f);
      const file = bytesToFile(buf, name);

      const whole = await analyzeWeb(file);
      const streamed = await analyzeWebStreaming(file);

      expect(streamed.stats).toEqual(whole.stats);
      expect(streamed.meta).toEqual(whole.meta);
      expect(streamed.firmware).toEqual(whole.firmware);
      expect(streamed.hardware).toEqual(whole.hardware);
      expect(streamed.iml).toEqual(whole.iml);
      expect(streamed.events).toEqual(whole.events);
      expect(streamed.rca).toEqual(whole.rca);
      expect(streamed.advisories).toEqual(whole.advisories);
    }, 300_000);
  }
});
