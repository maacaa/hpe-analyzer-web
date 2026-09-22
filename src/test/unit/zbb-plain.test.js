// Tests for the IML log-entry parsers across firmware generations (belt +
// plain echo blocks) and the echo dedupe in the zbb sink.
import { describe, expect, it } from "vitest";
import {
  extractLogEntries,
  extractPlainLogEntries,
} from "../../adapters/parsers/zbb.js";
import { createZbbScanner } from "../../adapters/parsers/zbb-stream.js";
import { scanZbbInto } from "../../adapters/parsers/zbb-sink.js";
import { createEmptyModel } from "../../domain/entities/model.js";
import { createDefaultKb } from "../../adapters/kb/kb.js";
import { buildLogRecord, u8concat } from "../helpers.js";

const encoder = new TextEncoder();

/**
 * Belt record (old generation, 22-byte gap): see buildLogRecord in helpers.
 */

/**
 * Newer-generation belt record: the `0D <type>` marker sits 26 bytes before
 * the date (a u32 seq + extra u16 live between the marker and the header)
 * instead of the older 22-byte gap. Header fields stay at the same offsets
 * relative to the date: `03 <sub>` at -18, class at -16, event at -14.
 */
function buildNewGenBelt({
  type = 0x0b,
  classCode = 0x0014,
  eventCode = 0x000b,
  date = "01/01/1970 00:00:00",
  id = 0xb0,
  message = "Server Critical Fault (Service Information: Power On Fault, System Board,  AUX/Main EFUSE (11h))",
} = {}) {
  const pre = new Uint8Array([0x39, 0x0d, type]);
  const seq = new Uint8Array([0x6a, 0x00, 0x00, 0x00]);
  const extra = new Uint8Array([0xd8, 0x00]);
  const three = new Uint8Array([0x03, 0x0f]);
  const cls = new Uint8Array([classCode & 0xff, classCode >> 8]);
  const evt = new Uint8Array([eventCode & 0xff, eventCode >> 8]);
  const entryNo = new Uint8Array([0x67, 0x03]); // iLO entry number (e.g. 871)
  const tail = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const dateBytes = encoder.encode(date + "\u0000");
  const idBytes = new Uint8Array([id & 0xff, id >> 8]);
  const msg = encoder.encode(message + "\u000a");
  return u8concat(pre, seq, extra, three, cls, evt, entryNo, tail, dateBytes, idBytes, msg);
}

const EFUSE_MSG =
  "Server Critical Fault (Service Information: Power On Fault, System Board,  AUX/Main EFUSE (11h))";

/**
 * Plain-text echo block:
 *   <lead> 00 00 | 0d 1a | <seq> | 03 0f | <class u16> | <event u16> |
 *   <len u16> | <10 fixed bytes> | <date string> 00 | <id u16> | <message> 0a
 */
function buildPlainEntry({
  classCode = 0x0014,
  eventCode = 0x000a,
  date = "09/06/2026 00:17:40",
  id = 0x00a9,
  message = EFUSE_MSG + "   ACTION: Gather logs.",
} = {}) {
  const head = new Uint8Array(25);
  head.set([0x0a, 0x00, 0x00, 0x0d, 0x1a], 0);
  head[5] = 0xd1;
  head[6] = 0x00;
  head[7] = 0x03;
  head[8] = 0x0f;
  head[9] = classCode & 0xff;
  head[10] = classCode >> 8;
  head[11] = eventCode & 0xff;
  head[12] = eventCode >> 8;
  head[15] = 0x01; // fixed-bytes pattern seen in the wild
  const dateBytes = encoder.encode(date + "\u0000");
  const idBytes = new Uint8Array([id & 0xff, id >> 8]);
  const msgBytes = encoder.encode(message + "\u000a");
  return u8concat(head, dateBytes, idBytes, msgBytes);
}

describe("extractLogEntries (belt, both generations)", () => {
  it("still parses old-generation belt entries (marker 22 bytes back)", () => {
    const entries = extractLogEntries(
      buildLogRecord({ classCode: 0x0014, eventCode: 0x000b, message: "Old gen entry." })
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ classCode: 0x0014, logType: "iml" });
  });

  it("parses belt entries of the newer generation (marker 26 bytes back)", () => {
    const entries = extractLogEntries(buildNewGenBelt());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      classCode: 0x0014,
      eventCode: 0x000b,
      date: "01/01/1970 00:00:00",
      logType: "iml",
    });
    expect(entries[0].message).toContain("Power On Fault");
  });

  it("rejects a belt-like record with a bad marker position", () => {
    const buf = buildNewGenBelt();
    buf[1] = 0x0f; // break the 0x0D marker byte
    expect(extractLogEntries(buf)).toHaveLength(0);
  });
});

describe("extractPlainLogEntries", () => {
  // echo copies with a valid timestamp are captured by the belt loop (the
  // date is the shared anchor), so extractPlainLogEntries only adds the
  // dateless ones — extractLogEntries covers both.
  it("skips echo blocks with a valid date (belt loop captures them)", () => {
    const echo = buildPlainEntry();
    const buf = u8concat(buildLogRecord({ message: "Belt entry." }), echo);
    expect(extractPlainLogEntries(echo)).toHaveLength(0);
    const all = extractLogEntries(buf);
    expect(all).toHaveLength(2);
    expect(all[1].echo).toBe(true);
    expect(all[1].message).toContain("Power On Fault");
  });

  it("parses entries whose date field is not a valid timestamp", () => {
    const entries = extractPlainLogEntries(buildPlainEntry({ date: "[Not Set]" }));
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe("[Not Set]");
    expect(entries[0].message).toContain("Power On Fault");
  });

  it("extractLogEntries appends dateless plain blocks after belt entries", () => {
    const buf = u8concat(
      buildLogRecord({ message: "Belt entry." }),
      buildPlainEntry({ date: "[Not Set]" })
    );
    const all = extractLogEntries(buf);
    expect(all).toHaveLength(2);
    expect(all[0].message).toBe("Belt entry.");
    expect(all[1].echo).toBe(true);
    expect(all[1].date).toBe("[Not Set]");
  });

  it("rejects binary noise that lacks the 03 header", () => {
    const noise = new Uint8Array([0x0a, 0x00, 0x00, 0x0d, 0x1a, 0xd1, 0x00, 0x99, 0x99]);
    expect(extractPlainLogEntries(noise)).toHaveLength(0);
  });
});

describe("zbb scanner: equivalence, chunk boundaries and sink dedupe", () => {
  function scanAll(buf, chunkSizes) {
    const entries = [];
    const scanner = createZbbScanner({
      onEntry: (e) => entries.push(e),
      onInline: () => {},
      onFirmwareMatches: () => {},
    });
    let off = 0;
    for (const size of chunkSizes) {
      scanner.push(buf.subarray(off, Math.min(buf.length, off + size)));
      off += size;
    }
    if (off < buf.length) scanner.push(buf.subarray(off));
    scanner.end();
    return entries;
  }

  const belt = buildLogRecord({
    classCode: 0x0014,
    eventCode: 0x000a,
    date: "09/06/2026 00:17:40",
    message: EFUSE_MSG + "   ACTION: Gather logs.",
  });
  const echo = buildPlainEntry();
  const payload = u8concat(belt, echo);

  it("scanner finds the echo entry and matches the whole-buffer extractor", () => {
    const scanned = scanAll(payload, [4096]);
    const expected = extractLogEntries(payload);
    expect(scanned).toHaveLength(2);
    expect(scanned).toEqual(expected);
  });

  it("scanner keeps plain/belt blocks that straddle chunk boundaries", () => {
    const whole = scanAll(payload, [payload.length]);
    for (const chunks of [[7, 13, 64, 1, 200], [3], [payload.length, 5]]) {
      const split = scanAll(payload, chunks);
      expect(split).toEqual(whole);
    }
  });

  it("sink dedupes the echo against its belt copy and keeps belt content", () => {
    const model = createEmptyModel("test.ahs");
    scanZbbInto(model, payload, createDefaultKb(), "test.zbb");
    expect(model.iml).toHaveLength(1);
    const entry = model.iml[0];
    expect(entry.id).toBe(1); // belt copy, not the echo id
    expect(entry.message).toContain("ACTION"); // belt message keeps ACTION
    expect(entry.severity).toBe("critical");
  });

  it("sink collapses an echo duplication carrying a junk trailing byte", () => {
    const junkEcho = buildPlainEntry({ message: EFUSE_MSG + "X" });
    const model = createEmptyModel("test.ahs");
    scanZbbInto(model, u8concat(belt, junkEcho), createDefaultKb(), "t.zbb");
    expect(model.iml).toHaveLength(1); // echo skipped despite the trailing junk
  });

  it("sink keeps a plain-only entry (no belt copy) with null timestamp", () => {
    const model = createEmptyModel("test.ahs");
    scanZbbInto(model, buildPlainEntry({ date: "[Not Set]" }), createDefaultKb(), "t.zbb");
    expect(model.iml).toHaveLength(1);
    expect(model.iml[0].date).toBe("[Not Set]");
    expect(model.iml[0].timestamp).toBeNull();
  });

  it("scanner finds the newer-generation belt entries too", () => {
    const newGen = u8concat(
      new Uint8Array([0x00, 0x7e, 0x41, 0x42, 0x00]),
      buildNewGenBelt()
    );
    const scanned = scanAll(newGen, [17]);
    expect(scanned).toEqual(extractLogEntries(newGen));
    expect(scanned).toHaveLength(1);
  });
});
