import { describe, it, expect } from "vitest";
import {
  extractLogEntries,
  extractEvents,
  extractInlineRecords,
} from "../../adapters/parsers/zbb.js";
import { buildLogRecord } from "../helpers.js";

const te = new TextEncoder();

describe("extractLogEntries", () => {
  it("extracts an IML record (type 0x0B)", () => {
    const buf = buildLogRecord({
      type: 0x0b,
      classCode: 0x000a,
      eventCode: 0x0469,
      date: "11/12/2024 21:30:24",
      id: 187,
      message: "Uncorrectable Error Detected. ACTION: Check IML.",
    });
    const entries = extractLogEntries(buf);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      date: "11/12/2024 21:30:24",
      classCode: 0x000a,
      eventCode: 0x0469,
      logType: "iml",
      id: 187,
    });
    expect(entries[0].message).toContain("Uncorrectable Error Detected");
  });

  it("distinguishes iLO Event Log (type 0x0C)", () => {
    const buf = buildLogRecord({
      type: 0x0c,
      classCode: 0,
      eventCode: 0,
      message: "Server reset.",
    });
    const entries = extractLogEntries(buf);
    expect(entries[0].logType).toBe("iel");
  });

  it("terminates message at newline and control chars", () => {
    const buf = buildLogRecord({ message: "hello", terminator: 0x0a });
    expect(extractLogEntries(buf)[0].message).toBe("hello");

    const buf2 = buildLogRecord({ message: "hello", terminator: 0x01 });
    expect(extractLogEntries(buf2)[0].message).toBe("hello");
  });

  it("ignores non-record date matches", () => {
    // Date without a valid 18 0D marker header should be skipped.
    const buf = te.encode("random 01/02/2024 03:04:05 garbage");
    expect(extractLogEntries(buf)).toHaveLength(0);
  });
});

describe("extractEvents", () => {
  it("extracts raised/lowered/pulsed events", () => {
    const text =
      "DISCOVERY_COMPLETE       (Raised) @ 123.456s\n" +
      "POST_COMPLETE            (Pulsed) @ 130.000s\n" +
      "DISCOVERY_COMPLETE       (Lowered) @ 200.0s\n";
    const events = extractEvents(te.encode(text));
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      name: "DISCOVERY_COMPLETE",
      state: "Raised",
      uptimeSeconds: 123.456,
    });
    expect(events[1].state).toBe("Pulsed");
    expect(events[2].state).toBe("Lowered");
  });
});

describe("extractInlineRecords", () => {
  it("extracts 18 0D inline name/value records", () => {
    // header: 18 0D 04 <len> 00, len = nameLength + 4
    const name = "CQSNET6IP";
    const value = "::";
    const header = new Uint8Array([0x18, 0x0d, 0x04, name.length + 4, 0x00]);
    const buf = new Uint8Array([
      ...header,
      ...te.encode(name),
      0,
      ...te.encode(value),
      0,
    ]);
    const recs = extractInlineRecords(buf);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ name: "CQSNET6IP", value: "::" });
  });
});
