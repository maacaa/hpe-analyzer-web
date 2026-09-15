import { describe, it, expect } from "vitest";
import {
  parseCustInfo,
  parseFilePkg,
  parseClist,
  parseCounters,
  parseBcert,
} from "../../adapters/parsers/subformats.js";
import { str0, u8concat } from "../helpers.js";

const te = new TextEncoder();

function writeU16LE(u8, off, value) {
  u8[off] = value & 0xff;
  u8[off + 1] = (value >>> 8) & 0xff;
}

function writeU32LE(u8, off, value) {
  u8[off] = value & 0xff;
  u8[off + 1] = (value >>> 8) & 0xff;
  u8[off + 2] = (value >>> 16) & 0xff;
  u8[off + 3] = (value >>> 24) & 0xff;
}

describe("parseCustInfo", () => {
  it("reads the five fixed-width fields", () => {
    const buf = u8concat(
      str0("12345", 15),
      str0("John Doe", 256),
      str0("555-1234", 40),
      str0("j@x.com", 256),
      str0("ACME", 256),
    );
    const r = parseCustInfo(buf);
    expect(r.caseNumber).toBe("12345");
    expect(r.contactName).toBe("John Doe");
    expect(r.phoneNumber).toBe("555-1234");
    expect(r.email).toBe("j@x.com");
    expect(r.companyName).toBe("ACME");
  });
});

describe("parseFilePkg", () => {
  it("returns the plain text", () => {
    expect(parseFilePkg(te.encode("a\nb"))).toContain("a");
  });
});

describe("parseClist", () => {
  it("parses 52-byte records", () => {
    const rec = new Uint8Array(52);
    rec[0] = 0x01;
    rec[1] = 0x34;
    rec.set(te.encode("0000001-2024-01-01.zbb"), 20);
    const names = parseClist(u8concat(rec, rec));
    expect(names).toEqual(["0000001-2024-01-01.zbb", "0000001-2024-01-01.zbb"]);
  });
});

describe("parseCounters", () => {
  it("parses header + counter items", () => {
    const buf = new Uint8Array(32 + 84);
    buf[0] = 0x05; // magic 05 00 00 00
    writeU16LE(buf, 32, 7); // id
    writeU32LE(buf, 32 + 12, 99); // value
    buf.set(te.encode("counter-one"), 32 + 20);
    const counters = parseCounters(buf);
    expect(counters[0]).toMatchObject({ id: 7, value: 99, name: "counter-one" });
  });
});

describe("parseBcert", () => {
  it("parses XML into a tree", () => {
    const xml = "<BC><MfgRecord><FirmwareLockdown><IntegratedLights-OutV>2.16</IntegratedLights-OutV></FirmwareLockdown></MfgRecord></BC>";
    const tree = parseBcert(te.encode(xml));
    expect(tree.BC).toBeDefined();
  });
});
