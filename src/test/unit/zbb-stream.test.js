import { describe, it, expect } from "vitest";
import {
  extractLogEntries,
  extractInlineRecords,
  extractFirmwareVersions,
} from "../../adapters/parsers/zbb.js";
import { createZbbScanner, parseIdentityAt } from "../../adapters/parsers/zbb-stream.js";
import { buildLogRecord, u8concat } from "../helpers.js";

const te = new TextEncoder();

function buildInlineRecord(name, value, type = 0x04) {
  const header = new Uint8Array([0x18, 0x0d, type, name.length + 4, 0x00]);
  return u8concat(
    header,
    te.encode(name),
    new Uint8Array([0]),
    te.encode(value),
    new Uint8Array([0])
  );
}

/** Synthetic zbb payload mixing log entries, inline records and firmware strings. */
function buildZbbPayload({ entryCount = 24 } = {}) {
  const parts = [te.encode("ZBB-HEADER junk without slashes 0123456789 ")];
  for (let i = 0; i < entryCount; i++) {
    // filler between records: no '/', no 18 0D markers
    parts.push(new Uint8Array([0x00, 0x7e, 0x41, 0x42, 0x00]));
    parts.push(
      buildLogRecord({
        type: i % 3 === 0 ? 0x0c : 0x0b,
        classCode: 0x000a + (i % 4),
        eventCode: 0x0400 + i,
        date: `0${(i % 9) + 1}/1${i % 3}/2024 ${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`,
        id: i + 1,
        message: `Test message number ${i} with padding text to vary lengths. ACTION: Do the thing ${i}.`,
      })
    );
  }
  parts.push(new Uint8Array([0x00, 0x7e]));
  parts.push(buildInlineRecord("PowerManagementFirmware", "1.2.3"));
  parts.push(new Uint8Array([0x00, 0x7e]));
  parts.push(buildInlineRecord("CQSNET6IP", "::"));
  parts.push(new Uint8Array([0x00, 0x7e]));
  parts.push(te.encode("System ROM\x00v2.34 some trailing text"));
  parts.push(new Uint8Array([0x00]));
  parts.push(te.encode("Redundant System ROM\x00v2.30"));
  parts.push(new Uint8Array([0x00]));
  parts.push(te.encode("Power Management Controller Firmware\x001.05.02"));
  parts.push(new Uint8Array([0x00]));
  parts.push(te.encode("iLO 5 v2.16p07 built on Jun 24 2020"));
  parts.push(new Uint8Array([0x00, 0x7e, 0x00]));
  return u8concat(...parts);
}

function rawSink() {
  const collected = { entries: [], inline: [], fw: null, identity: [] };
  return {
    collected,
    onEntry(e) {
      collected.entries.push(e);
    },
    onInline(iv) {
      collected.inline.push(iv);
    },
    onFirmwareMatches(fw, ilo) {
      collected.fw = { fw, ilo };
    },
    onSystemIdentity(identity) {
      collected.identity.push(identity);
    },
  };
}

function scanChunked(payload, chunkSize) {
  const sink = rawSink();
  const scanner = createZbbScanner(sink);
  for (let off = 0; off < payload.length; off += chunkSize) {
    scanner.push(payload.subarray(off, Math.min(off + chunkSize, payload.length)));
  }
  scanner.end();
  return sink.collected;
}

/** Firmware finalize replicated from zbb-sink (order-sensitive). */
function finalizeFirmware(collected) {
  const FW_NAME_VALUE = [
    "System ROM",
    "Redundant System ROM",
    "Power Management Controller Firmware",
    "Power Management Controller FW Bootloader",
  ];
  const out = [];
  for (const name of FW_NAME_VALUE) {
    for (const m of collected.fw.fw) {
      if (m.name !== name) continue;
      if (!out.some((o) => o.name === name && o.version === m.version)) {
        out.push({ name, version: m.version });
      }
    }
  }
  if (collected.fw.ilo.length > 0) {
    out.push({ name: "iLO", version: collected.fw.ilo[0].version });
  }
  return out;
}

describe("createZbbScanner equivalence vs whole-buffer extractors", () => {
  const payload = buildZbbPayload();
  const expectedEntries = extractLogEntries(payload);
  const expectedInline = extractInlineRecords(payload);
  const expectedFw = extractFirmwareVersions(payload);

  it("whole-buffer single push matches the original extractors", () => {
    const c = scanChunked(payload, payload.length);
    expect(c.entries).toEqual(expectedEntries);
    expect(c.inline).toEqual(expectedInline);
    expect(finalizeFirmware(c)).toEqual(
      expectedFw.map((f) => ({ name: f.name, version: f.version }))
    );
  });

  for (const chunkSize of [1, 2, 3, 7, 23, 44, 45, 64, 100, 255, 4095, 4096, 4097, 10000]) {
    it(`chunk size ${chunkSize} matches the original extractors`, () => {
      const c = scanChunked(payload, chunkSize);
      expect(c.entries).toEqual(expectedEntries);
      expect(c.inline).toEqual(expectedInline);
      expect(finalizeFirmware(c)).toEqual(
        expectedFw.map((f) => ({ name: f.name, version: f.version }))
      );
    });
  }

  it("entries straddling every possible chunk boundary are found exactly once", () => {
    // single entry embedded in filler; split at every offset
    const single = u8concat(
      new Uint8Array([0x00, 0x7e, 0x41]),
      buildLogRecord({
        type: 0x0b,
        classCode: 0x000a,
        eventCode: 0x0469,
        date: "11/12/2024 21:30:24",
        id: 187,
        message: "Boundary test message. ACTION: Check.",
      }),
      new Uint8Array([0x00, 0x7e])
    );
    const expected = extractLogEntries(single);
    expect(expected).toHaveLength(1);
    for (let split = 1; split < single.length; split++) {
      const sink = rawSink();
      const scanner = createZbbScanner(sink);
      scanner.push(single.subarray(0, split));
      scanner.push(single.subarray(split));
      scanner.end();
      expect(sink.collected.entries).toEqual(expected);
    }
  });

  it("an inline record straddling every chunk boundary is found exactly once", () => {
    const rec = u8concat(
      new Uint8Array([0x00, 0x7e]),
      buildInlineRecord("FirmwareVersionThing", "9.9.9"),
      new Uint8Array([0x00, 0x7e])
    );
    const expected = extractInlineRecords(rec);
    expect(expected).toHaveLength(1);
    for (let split = 1; split < rec.length; split++) {
      const sink = rawSink();
      const scanner = createZbbScanner(sink);
      scanner.push(rec.subarray(0, split));
      scanner.push(rec.subarray(split));
      scanner.end();
      expect(sink.collected.inline).toEqual(expected);
    }
  });

  it("a firmware string straddling every chunk boundary is found exactly once", () => {
    const rec = u8concat(
      new Uint8Array([0x00, 0x7e]),
      te.encode("System ROM\x00v3.06"),
      new Uint8Array([0x00, 0x7e])
    );
    const sink = rawSink();
    const scanner = createZbbScanner(sink);
    for (let split = 1; split < rec.length; split++) {
      scanner.push(rec.subarray(split - 1, split));
    }
    scanner.end();
    expect(finalizeFirmware(sink.collected)).toEqual([
      { name: "System ROM", version: "v3.06" },
    ]);
  });

  it("a trailing entry without terminator is flushed at end() like the original", () => {
    const rec = u8concat(
      buildLogRecord({ message: "complete one." }),
      new Uint8Array([0x00, 0x7e]),
      buildLogRecord({ message: "no terminator tail" }).subarray(0, 50)
    );
    // strip the terminator from the tail record so it runs to buffer end
    const expected = extractLogEntries(rec);
    expect(expected).toHaveLength(2);
    const c = scanChunked(rec, 7);
    expect(c.entries).toEqual(expected);
  });

  it("empty and tiny chunks are handled", () => {
    const sink = rawSink();
    const scanner = createZbbScanner(sink);
    scanner.push(new Uint8Array(0));
    scanner.push(payload.subarray(0, 10));
    scanner.push(new Uint8Array(0));
    scanner.push(payload.subarray(10));
    scanner.end();
    expect(sink.collected.entries).toEqual(expectedEntries);
  });
});

describe("zbb-stream: system identity tuple", () => {
  // real-unit pattern: HPE\0<ProductName>\0<UnitSerial>\0<ProductId>\0
  function identityBlock() {
    // real order: HPE\0<ProductName>\0<UnitSerial>\0<ProductId>\0
    return u8concat(
      te.encode("HPE"),
      new Uint8Array([0]),
      te.encode("ProLiant DL360 Gen10"),
      new Uint8Array([0]),
      te.encode("SGH202W6ZR"),
      new Uint8Array([0]),
      te.encode("869121-B21"),
      new Uint8Array([0])
    );
  }

  it("parses the identity tuple", () => {
    expect(parseIdentityAt(identityBlock(), 0)).toEqual({
      productName: "ProLiant DL360 Gen10",
      serialNumber: "SGH202W6ZR",
      partNumber: "869121-B21",
    });
  });

  it("parses Gen11 part numbers with a letter prefix", () => {
    const block = u8concat(
      te.encode("HPE"),
      new Uint8Array([0]),
      te.encode("ProLiant DL325 Gen11"),
      new Uint8Array([0]),
      te.encode("CZUD3M01TD"),
      new Uint8Array([0]),
      te.encode("P54960-B21"),
      new Uint8Array([0])
    );
    expect(parseIdentityAt(block, 0)).toEqual({
      productName: "ProLiant DL325 Gen11",
      serialNumber: "CZUD3M01TD",
      partNumber: "P54960-B21",
    });
  });

  it("rejects non-identity HPE\\0 needles (firmware family data)", () => {
    const block = u8concat(
      te.encode("HPE"),
      new Uint8Array([0]),
      te.encode("U32"),
      new Uint8Array([0]),
      te.encode("04/01/2026"),
      new Uint8Array([0])
    );
    expect(parseIdentityAt(block, 0)).toBeNull();
  });

  it("scanner emits the identity exactly once, even straddling chunk edges", () => {
    const block = u8concat(identityBlock(), new Uint8Array([0x00, 0x7e]));
    for (let split = 1; split < block.length; split++) {
      const sink = rawSink();
      const scanner = createZbbScanner(sink);
      scanner.push(block.subarray(0, split));
      scanner.push(block.subarray(split));
      scanner.end();
      expect(sink.collected.identity).toHaveLength(1);
      expect(sink.collected.identity[0].serialNumber).toBe("SGH202W6ZR");
      expect(sink.collected.identity[0].partNumber).toBe("869121-B21");
    }
  });
});
