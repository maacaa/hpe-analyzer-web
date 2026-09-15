// ZBB (black-box) payload parsers.
//
// Memory-conscious: all scanning is done directly on the raw byte array (no
// full buffer -> string conversion), so large files stay memory-bounded.
// Avoids Buffer-only APIs so the browser edition works without a polyfill.
//
// Log record layout (anchored on the ASCII date "MM/DD/YYYY HH:MM:SS"):
//   recStart = dateStart - 23
//   recStart[0..2]  marker = 18 0D <type>   (0x0B = IML, 0x0C = iLO Event Log)
//   recStart[7..8]  class code (u16 LE)
//   recStart[9..10] event code (u16 LE)
//   date            null-terminated, 19 chars
//   after date      2-byte id, then message (terminated by \n / null / ctrl)

import { u16le, latin1, indexOfSeq, textBytes } from "./bytes.js";

const isDigit = (b) => b >= 0x30 && b <= 0x39;

/** Validate an "MM/DD/YYYY HH:MM:SS" ASCII date at buf[s..s+19). (exported for the incremental scanner) */
export function matchDate(buf, s) {
  return (
    s + 19 <= buf.length &&
    isDigit(buf[s]) && isDigit(buf[s + 1]) && buf[s + 2] === 0x2f &&
    isDigit(buf[s + 3]) && isDigit(buf[s + 4]) && buf[s + 5] === 0x2f &&
    isDigit(buf[s + 6]) && isDigit(buf[s + 7]) && isDigit(buf[s + 8]) && isDigit(buf[s + 9]) &&
    buf[s + 10] === 0x20 &&
    isDigit(buf[s + 11]) && isDigit(buf[s + 12]) && buf[s + 13] === 0x3a &&
    isDigit(buf[s + 14]) && isDigit(buf[s + 15]) && buf[s + 16] === 0x3a &&
    isDigit(buf[s + 17]) && isDigit(buf[s + 18])
  );
}

function readMessage(buf, start) {
  let end = start;
  while (end < buf.length) {
    const c = buf[end];
    if (c === 0 || c === 0x0a || c < 0x20) break;
    end++;
  }
  return latin1(buf, start, end).trim();
}

/** Extract IML / iLO Event Log entries from a decoded zbb buffer. */
export function extractLogEntries(buf) {
  const entries = [];
  const slash = 0x2f;
  let pos = 0;
  while (pos < buf.length) {
    const i = buf.indexOf(slash, pos);
    if (i < 0) break;
    const dateStart = i - 2;
    if (dateStart >= 0 && matchDate(buf, dateStart)) {
      const recStart = dateStart - 23;
      if (recStart >= 0 && buf[recStart] === 0x18 && buf[recStart + 1] === 0x0d) {
        const type = buf[recStart + 2];
        const logType = type === 0x0b ? "iml" : type === 0x0c ? "iel" : "unknown";
        const classCode = u16le(buf, recStart + 7);
        const eventCode = u16le(buf, recStart + 9);
        const date = latin1(buf, dateStart, dateStart + 19);

        let p = dateStart + 20; // date + null
        const id = u16le(buf, p);
        p += 2;
        const message = readMessage(buf, p);
        if (message) {
          entries.push({ date, id, classCode, eventCode, logType, message });
        }
      }
      pos = dateStart + 19;
    } else {
      pos = i + 1;
    }
  }
  return entries;
}

const EVENT_VERBS = [
  { needle: textBytes("(Raised)"), state: "Raised" },
  { needle: textBytes("(Lowered)"), state: "Lowered" },
  { needle: textBytes("(Pulsed)"), state: "Pulsed" },
];

/** Extract platform events "NAME (verb) @ seconds" (buffer-based, in document order). */
export function extractEvents(buf) {
  const events = [];
  let pos = 0;
  while (pos < buf.length) {
    // find the next verb occurrence (in document order)
    let best = null;
    for (const v of EVENT_VERBS) {
      const i = indexOfSeq(buf, v.needle, pos);
      if (i >= 0 && (best === null || i < best.i)) best = { i, ...v };
    }
    if (best === null) break;
    const i = best.i;
    // read name backwards (skip spaces, then the name token)
    let nameEnd = i;
    while (nameEnd > 0 && buf[nameEnd - 1] === 0x20) nameEnd--;
    let nameStart = nameEnd;
    while (nameStart > 0 && buf[nameStart - 1] > 0x20 && buf[nameStart - 1] < 0x7f) nameStart--;
    const name = latin1(buf, nameStart, nameEnd).trim();
    // read "@ seconds" forward
    let at = buf.indexOf(0x40, i + best.needle.length); // '@'
    if (at >= 0) {
      let s = at + 1;
      while (s < buf.length && buf[s] <= 0x20) s++; // skip whitespace
      let e = s;
      while (e < buf.length && (isDigit(buf[e]) || buf[e] === 0x2e)) e++;
      const secStr = latin1(buf, s, e);
      const uptimeSeconds = parseFloat(secStr);
      if (name && !Number.isNaN(uptimeSeconds)) {
        events.push({ name, state: best.state, uptimeSeconds });
      }
    }
    pos = i + best.needle.length;
  }
  return events;
}

/** Inline name/value records (§3.2): `18 0D <type> <len> 00` + name + value. */
export function extractInlineRecords(buf) {
  const records = [];
  let off = 0;
  while (off + 5 <= buf.length) {
    if (buf[off] !== 0x18 || buf[off + 1] !== 0x0d) {
      off++;
      continue;
    }
    const type = buf[off + 2];
    const len = buf[off + 3];
    if (off + 5 + len > buf.length) break;
    const nameStart = off + 5;
    const nameEnd = nameStart + len - 4;
    if (nameEnd <= nameStart) {
      off++;
      continue;
    }
    const name = latin1(buf, nameStart, nameEnd).replace(/\0.*$/, "");
    let valStart = nameEnd;
    while (valStart < buf.length && buf[valStart] === 0) valStart++;
    let valEnd = valStart;
    while (valEnd < buf.length && buf[valEnd] !== 0) valEnd++;
    const value = latin1(buf, valStart, valEnd);
    if (name && value !== "") records.push({ name, type, value });
    off = valEnd + 1;
  }
  return records;
}

/** Firmware keys extracted as `name\0version` pairs (exported for the incremental scanner). */
export const FW_NAME_VALUE = [
  "System ROM",
  "Redundant System ROM",
  "Power Management Controller Firmware",
  "Power Management Controller FW Bootloader",
];

/**
 * Extract current firmware versions stored as `name\0value\0` pairs, plus the
 * iLO version string ("iLO 5 v2.16p07 built on Jun 24 2020").
 */
export function extractFirmwareVersions(buf) {
  const out = [];
  for (const name of FW_NAME_VALUE) {
    const needle = textBytes(name);
    let pos = 0;
    while (pos < buf.length) {
      const i = indexOfSeq(buf, needle, pos);
      if (i < 0) break;
      if (buf[i + needle.length] === 0) {
        let v = i + needle.length + 1;
        let e = v;
        while (e < buf.length && buf[e] >= 0x20 && buf[e] < 0x7f) e++;
        const version = latin1(buf, v, e).trim();
        if (version && !out.some((o) => o.name === name && o.version === version)) {
          out.push({ name, version });
        }
      }
      pos = i + needle.length;
    }
  }

  // iLO version string
  const iloNeedle = textBytes("iLO ");
  let p = 0;
  while (p < buf.length && !out.some((o) => o.name === "iLO")) {
    const i = indexOfSeq(buf, iloNeedle, p);
    if (i < 0) break;
    let e = i;
    while (e < buf.length && e - i < 80 && buf[e] !== 0 && buf[e] >= 0x20) e++;
    const seg = latin1(buf, i, e);
    const m = /iLO\s*\d+\s+v(\d+(?:\.\d+)+[a-z]?\d*)\s+built on\s+([A-Za-z]+ \d+ \d+)/.exec(seg);
    if (m) {
      out.push({ name: "iLO", version: m[1], date: m[2] });
    }
    p = i + iloNeedle.length;
  }
  return out;
}
