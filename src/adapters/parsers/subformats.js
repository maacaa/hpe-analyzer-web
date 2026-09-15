// Parsers for the "simple" records inside an AHS container:
//   CUST_INFO.DAT, file.pkg, clist.pkg, counters.pkg, bcert.pkg
//
// All multi-byte integers are little-endian. "string0" fields are fixed-size
// buffers holding a null-terminated ASCII string.
//
// Works on plain Uint8Array (Buffer passes transparently) so the browser
// edition needs no Buffer polyfill.

import { XMLParser } from "fast-xml-parser";
import { string0, u16le, u32le, latin1 } from "./bytes.js";

/** CUST_INFO.DAT: five fixed-width strings (total 823 bytes). */
export function parseCustInfo(buf) {
  return {
    caseNumber: string0(buf, 0, 15),
    contactName: string0(buf, 15, 256),
    phoneNumber: string0(buf, 271, 40),
    email: string0(buf, 311, 256),
    companyName: string0(buf, 567, 256),
  };
}

/** file.pkg: plain-text listing of the blackbox data directory. */
export function parseFilePkg(buf) {
  return latin1(buf, 0, buf.length);
}

/**
 * clist.pkg: sequence of 52-byte records listing zbb filenames.
 * Layout per record (little-endian):
 *   magic  [4] = 01 34 00 00
 *   pad1   [2] = 0
 *   bits   [2]
 *   pad2   [12]
 *   name   [32] null-terminated
 */
export function parseClist(buf) {
  const names = [];
  const recSize = 52;
  for (let off = 0; off + recSize <= buf.length; off += recSize) {
    if (buf[off] !== 0x01 || buf[off + 1] !== 0x34) continue;
    const name = string0(buf, off + 20, 32);
    if (name) names.push(name);
  }
  return names;
}

/**
 * counters.pkg: header + 6 counters. Layout (little-endian):
 *   magic [4] = 05 00 00 00
 *   pad   [28]
 *   counter[6], each:
 *     id      [2]
 *     unknown [2]
 *     bits    [2]
 *     pad1    [6]
 *     value   [4]
 *     pad2    [4]
 *     name    [64] null-terminated
 */
export function parseCounters(buf) {
  if (buf.length < 32) return [];
  const counters = [];
  let off = 32;
  const itemSize = 84;
  for (let i = 0; i < 6 && off + itemSize <= buf.length; i++, off += itemSize) {
    counters.push({
      id: u16le(buf, off),
      value: u32le(buf, off + 12),
      name: string0(buf, off + 20, 64),
    });
  }
  return counters;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  // Hardening for untrusted bcert.pkg XML: bound nesting depth and XML entity
  // expansion ("billion laughs").
  maxNestedTags: 100,
  maxEntitySize: 100000,
  maxEntityCount: 100000,
  maxExpansionDepth: 10,
  maxTotalExpansions: 100000,
  maxExpandedLength: 10000000,
});

// bcert.pkg is a small factory record (a few KB in practice); anything larger
// is malformed or hostile.
const MAX_BCERT_SIZE = 16 * 1024 * 1024; // 16 MiB

/**
 * bcert.pkg: gzip-compressed XML (MfgRecord) containing factory test results,
 * firmware versions and the hardware build of materials.
 *
 * Returns the raw parsed XML tree; higher-level mapping is done by the
 * classification layer so that no data is discarded.
 */
export function parseBcert(buf) {
  const text = latin1(buf, 0, buf.length).replace(/\0/g, "");
  if (text.length > MAX_BCERT_SIZE) {
    throw new Error(`bcert.pkg exceeds the ${MAX_BCERT_SIZE} byte limit`);
  }
  return xmlParser.parse(text);
}
