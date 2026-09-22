// Incremental ZBB scanner (RNF-1/3): consumes a decompressed record as a
// stream of chunks with O(chunk) memory instead of materializing the whole
// buffer. It replicates the semantics of the whole-buffer extractors in
// zbb.js:
//   - extractLogEntries       -> sink.onEntry
//   - extractInlineRecords    -> sink.onInline
//   - extractFirmwareVersions -> sink.onFirmwareMatches (at end)
// (extractEvents is not part of the analysis pipeline, so it is not scanned.)
//
// Strategy: sliding window. Every push concatenates the kept tail with the
// new chunk and rescans it. Complete matches are emitted immediately,
// deduplicated by absolute stream position (which strictly increases for
// every extractor, exactly like the whole-buffer `pos` advance). A match
// that would extend past the window end pauses that extractor until more
// data arrives. The window always keeps at least OVERLAP bytes (>= 64 per
// RNF-3, sized to also cover inline records and firmware context) so any
// pattern straddling a chunk boundary is fully visible on the next push.

import { u16le, latin1, indexOfSeq, textBytes } from "./bytes.js";
import {
  matchDate,
  FW_NAME_VALUE,
  PLAIN_NEEDLE,
  parseBlock,
  logVariantAt,
} from "./zbb.js";

const SLASH = 0x2f;
const OVERLAP = 4096;

const isDigit = (b) => b >= 0x30 && b <= 0x39;

/** Index just past the message body (position of the \n/null/ctrl terminator). */
function findMessageEnd(buf, start) {
  let end = start;
  while (end < buf.length) {
    const c = buf[end];
    if (c === 0 || c === 0x0a || c < 0x20) break;
    end++;
  }
  return end;
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const FW_NEEDLES = FW_NAME_VALUE.map((name) => ({ name, needle: textBytes(name) }));
const ILO_NEEDLE = textBytes("iLO ");
const ILO_RE = /iLO\s*\d+\s+v(\d+(?:\.\d+)+[a-z]?\d*)\s+built on\s+([A-Za-z]+ \d+ \d+)/;

// PCI device table rows (iLO platform inventory serialized in the zbb):
//   <device name>\0 ...4 fixed N/A placeholder fields... <manufacturer>\0
//   <4-hex subsystem/vendor ID>\0 [padding + raw PCI IDs: LE16 vendor,
//   LE16 device, LE16 subsystem vendor, LE16 subsystem device]
//   <driver/firmware version>\0
// The four N/A fields are null-terminated strings padded with NULs (16-24 B
// stride), so the anchor is a streak of four "N/A\0" occurrences at close
// range. Rows repeat on every snapshot: emissions are deduplicated by
// absolute offset (stream scanner) and by identity (sink).
const NA_NEEDLE = textBytes("N/A\x00");
const PCI_LOOK_BACK = 96; // bytes inspected before a row anchor
const PCI_LOOK_AHEAD = 96; // bytes inspected after the N/A-streak anchor
const PCI_STREAK_MAX_GAP = 26; // max bytes between consecutive N/A fields

/** Extract printable runs (>= minLen) from a byte range. Returns [{start,end}] */
function printableRuns(buf, from, to, minLen) {
  const runs = [];
  let start = -1;
  const lo = Math.max(0, from);
  const hi = Math.min(buf.length, to);
  for (let o = lo; o < hi; o++) {
    const c = buf[o];
    const ok = c >= 0x20 && c < 0x7f;
    if (ok) {
      if (start < 0) start = o;
    } else if (start >= 0) {
      if (o - start >= minLen) runs.push({ start, end: o });
      start = -1;
    }
  }
  if (start >= 0 && hi - start >= minLen && (hi === buf.length || minLen === 0)) {
    // unterminated run at window end: report so caller can wait for more data
    runs.push({ start, end: -1 });
  }
  return runs;
}

/**
 * Validate a PCI row anchored on its first-of-four N/A field. Returns the
 * parsed row or null when the bytes don't match a PCI table row. When more
 * bytes are needed, sets the `needMore` flag.
 * @param {Uint8Array} buf
 * @param {number} i relative anchor position (start of the 4 N/A fields)
 */
export function parsePciRow(buf, i) {
  const n = buf.length;
  const anchorEnd = i + 4 * NA_NEEDLE.length;
  // Row data extends up to ~24 bytes past the anchorEnd for the manufacturer,
  // then the VID string, the ID tuple and the driver version. Require all of
  // it to be inside the window before validating.
  const need = anchorEnd + PCI_LOOK_AHEAD;
  if (n < need) return { needMore: true };

  // 1) Device name: last printable run (>= 4 chars) in the look-back window.
  const runs = printableRuns(buf, i - PCI_LOOK_BACK, i, 4);
  const nameRun = runs.length ? runs[runs.length - 1] : null;
  if (!nameRun || nameRun.end < 0) return { needMore: !runs.some((r) => r.end < 0) };
  const name = latin1(buf, nameRun.start, nameRun.end).trim();
  if (!name || !/[A-Za-z]/.test(name) || name === "N/A") {
    if (nameRun.end < 0) return { needMore: true };
    return null;
  }
  if (nameRun.end < 0) return { needMore: true };

  // 2) Manufacturer: first printable run (>= 2) after the anchor that is
  //    not one of the four fixed N/A placeholder fields.
  let manufacturer = null;
  let manEnd = anchorEnd;
  for (let o = anchorEnd; o < Math.min(n, anchorEnd + 64); o++) {
    const run = printableRuns(buf, o, Math.min(n, o + 44), 2)[0];
    if (!run || run.end < 0) {
      if (o + 44 > buf.length) return { needMore: true };
      break;
    }
    const text = latin1(buf, run.start, run.end).trim();
    // N/A placeholder fields can be cut mid-string by the anchor arithmetic
    // (their stride varies between rows); treat any N/A-fitting fragment as
    // a placeholder and keep scanning for the real manufacturer.
    if (text && !/^(\/?A|N?\/?A)$/.test(text)) {
      manufacturer = text;
      manEnd = run.end;
      break;
    }
    o = run.end;
  }
  if (!manufacturer) return null;

  // 3) Subsystem vendor string: 4 hex chars within the next 48 bytes.
  let subsystemVendorId = null;
  let vidEnd = manEnd;
  {
    let o = manEnd;
    while (o < Math.min(n, manEnd + 48)) {
      const run = printableRuns(buf, o, Math.min(n, o + 44), 4)[0];
      if (!run || run.end < 0) {
        if (o + 44 > buf.length) return { needMore: true };
        break;
      }
      const text = latin1(buf, run.start, run.end).trim();
      if (/^[0-9A-Fa-f]{4}$/.test(text)) {
        subsystemVendorId = text.toUpperCase();
        vidEnd = run.end;
        break;
      }
      o = run.end;
    }
  }
  if (!subsystemVendorId) return null;

  // 4) Raw PCI IDs: the 8-byte LE tuple ending right before the driver
  //    version string (padding NULs can precede it).
  const drvRun = printableRuns(buf, vidEnd, vidEnd + 64, 2)[0];
  if (!drvRun || drvRun.end < 0) {
    return { needMore: vidEnd + 64 > buf.length };
  }
  const drvText = latin1(buf, drvRun.start, drvRun.end).trim();
  const drvAt = /[0-9][0-9A-Za-z. -]*$/.exec(drvText);
  if (!drvAt) return null;
  const drvStart = drvRun.start + drvAt.index;
  const driverVersion = drvAt[0];
  const rawStart = drvStart - 8;
  if (rawStart < vidEnd) return null;
  const raw = buf.subarray(rawStart, drvStart);

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const vendorId = u16(raw, 0);
  const deviceId = u16(raw, 2);
  const subsystemDeviceId = u16(raw, 6);
  if (vendorId === 0 || vendorId === 0xffff) return null;

  return {
    name,
    manufacturer,
    vendorId,
    deviceId,
    subsystemVendorId,
    subsystemDeviceId,
    driverVersion,
  };
}

/** Scan the PCI device-table rows of one zbb snapshot (see zbb-sink).
 * `state.last` keeps the absolute offset of the last emitted row. */
function scanPciCardTable(buf, base, final, sink, state) {
  const n = buf.length;
  let pos = 0;
  /** @type {number[]} recent "N/A\0" positions forming the 4-field streak */
  const streak = [];
  while (pos < n) {
    const i = indexOfSeq(buf, NA_NEEDLE, pos);
    if (i < 0) break;
    if (streak.length && i - streak[streak.length - 1] > PCI_STREAK_MAX_GAP) {
      streak.length = 0;
    }
    streak.push(i);
    if (streak.length === 4) {
      const anchor = streak[0];
      streak.length = 0;
      const rowStart = Math.max(0, anchor - PCI_LOOK_BACK);
      if (anchor < PCI_LOOK_BACK || anchor + 4 * NA_NEEDLE.length + PCI_LOOK_AHEAD > n) {
        if (!final) return { stop: rowStart };
      } else if (base + anchor > state.last) {
        const row = parsePciRow(buf, anchor);
        if (row && row.needMore) return { stop: rowStart };
        if (row) {
          state.last = base + anchor;
          sink.onPciCard(row);
        }
      }
      pos = Math.max(pos + 1, anchor + 4 * NA_NEEDLE.length);
      continue;
    }
    pos = i + 1;
  }
  return { stop: -1 };
}

// Platform inventory rows (iLO 6 / Gen11+/Gen12 "plat_inv" serialized in the
// zbb): each row is a fixed 32-byte null-terminated string-slot chain, whose
// first slot holds the location text ("PCI-E Slot 2", "OCP 3.0 Slot 14"),
// followed by manufacturer ("Empty slot N" for vacant slots), model and
// part/spare numbers, MAC address and a version. Blank slots are NUL-packed
// and the trailing slots may carry binary frame bytes, so field positions
// are classified by shape. Rows repeat on every snapshot; the sink merges
// and dedupes by identity.
const SLOT_TEXT_NEEDLES = ["PCI-E Slot ", "OCP 3.0 Slot ", "OCP 25GbE Slot ", "OCP 50GbE Slot "].map(
  (s) => ({ text: s, needle: textBytes(s) })
);
const SLOT_STRIDE = 32;
const SLOT_ROW_FIELDS = 10;

/**
 * Validate and parse one platform-inventory row anchored at the location
 * text. Returns the row or null; `{needMore: true}` when the window runs out.
 */
export function parseSlotRow(buf, i) {
  const base = i;
  if (base + SLOT_STRIDE > buf.length) return { needMore: true };
  if (base + SLOT_STRIDE > buf.length) return { needMore: true };
  // Rows are slot-aligned: the location string is preceded by a NUL (slot
  // padding). Anchors that start mid-text are not plat_inv rows.
  if (buf[base - 1] !== 0) return null;
  let z = base;
  while (z < base + SLOT_STRIDE && buf[z] !== 0) z++;
  if (z === base + SLOT_STRIDE) return null; // location itself must be NUL-terminated
  const location = latin1(buf, base, z).trim();
  if (!/^(PCI-E Slot \d+|OCP[^\x00]*)$/.test(location)) return null;

  const slot = (k) => {
    const off = base + k * SLOT_STRIDE;
    const end = off + SLOT_STRIDE;
    if (end > buf.length) return { needMore: true };
    let zz = off;
    while (zz < end && buf[zz] !== 0) zz++;
    if (zz === end) return ""; // blank (NUL-packed) slot or binary junk; trip later
    const text = latin1(buf, off, zz).replace(/[\x00-\x1f]/g, "").trim();
    return text;
  };

  // Manufacturer: the first non-empty slot after the location may sit one or
  // two strides away depending on the row layout ("Empty slot N" rows leave
  // the second slot blank).
  let manufacturerSlot = -1;
  let manufacturer = "";
  for (let k = 1; k <= 3; k++) {
    const t = slot(k);
    if (typeof t === "object") return t;
    if (t && t !== "N/A") {
      manufacturer = t;
      manufacturerSlot = k;
      break;
    }
  }
  if (!manufacturer) return null;
  const empty = /^Empty slot/i.test(manufacturer);
  // Sanity: manufacturers/models are readable text (drops binary junk like
  // "%" or "$" that can sit in trailing frame bytes, or partial next-row
  // strings that bleed into the slot window).
  const sane = (s) =>
    (/^[A-Za-z][A-Za-z0-9 .,'\-\/]{2,62}$/.test(s) || /^Empty slot/i.test(s)) &&
    !/Slot \d/i.test(s);
  if (!empty && !sane(manufacturer)) return null;
  let model = "";
  for (let k = manufacturerSlot + 1; k <= 4 && k < SLOT_ROW_FIELDS; k++) {
    const t = slot(k);
    if (typeof t === "object") return t;
    if (t && t !== "N/A" && sane(t)) {
      model = t;
      break;
    }
    if (t && !sane(t)) return null; // binary junk in the model slot, not a row
  }
  const rest = [];
  for (let k = manufacturerSlot + (model ? 2 : 1); k < SLOT_ROW_FIELDS; k++) {
    const t = slot(k);
    if (typeof t === "object") return t;
    if (t && t !== "N/A") rest.push(t);
  }
  const pnRe = /^[A-Z]?[0-9A-Z]{3,8}-[0-9A-Z]{3}$/;
  return {
    location,
    manufacturer: empty ? null : manufacturer,
    empty,
    emptyLabel: manufacturer,
    model: model && model !== "N/A" ? model : null,
    partNumber: rest.find((f) => pnRe.test(f)) ?? null,
    sparePartNumber: rest.find((f) => pnRe.test(f) && f !== (rest.find((f) => pnRe.test(f)) ?? "")) ?? null,
    macAddress: rest.find((f) => /^[0-9A-F]{12}$/.test(f)) ?? null,
    version: rest.find((f) => /^[0-9][0-9.]{2,}$/.test(f)) ?? null,
  };
}

/** Scan platform-inventory slot rows of one zbb snapshot (see zbb-sink). */
function scanSlotTable(buf, base, final, sink) {
  const n = buf.length;
  for (const t of SLOT_TEXT_NEEDLES) {
    let pos = 0;
    while (pos < n) {
      const i = indexOfSeq(buf, t.needle, pos);
      if (i < 0) break;
      const rowStart = Math.max(0, i - 16);
      if (i + (SLOT_ROW_FIELDS + 1) * SLOT_STRIDE > n) {
        if (!final) return { stop: rowStart };
        pos = i + 1;
        continue;
      }
      const row = parseSlotRow(buf, i);
      if (row && row.needMore) return { stop: rowStart };
      if (row) sink.onPlatformSlot(row);
      pos = i + t.needle.length;
    }
  }
  return { stop: -1 };
}

// System identity tuple emitted by every zbb snapshot (see zbb-sink.js):
//   HPE\0<ProductName>\0<UnitSerial>\0<ProductId>\0
// The unit serial lives here when the bcert has no DiagProcess section.
const IDENT_NEEDLE = textBytes("HPE\0");
const IDENT_LOOKUP = 240;

/**
 * Validate and parse a system identity tuple at buf[i] (needle included).
 * Returns the parsed identity or null when bytes don't form the tuple.
 */
export function parseIdentityAt(buf, i) {
  // part-number formats seen in the wild: "869121-B21" (Gen10) and
  // "P54960-B21" (Gen11) — optional leading letter, 5-6 digits, suffix.
  const m = /^HPE\x00([^\x00]{2,80})\x00([A-Z0-9]{9,11})\x00([A-Z]?[0-9]{5,6}-[A-Z0-9]{2,4})\x00/.exec(
    latin1(buf, i, Math.min(buf.length, i + IDENT_LOOKUP))
  );
  if (!m) return null;
  return { productName: m[1], serialNumber: m[2], partNumber: m[3] };
}

/**
  * Create an incremental scanner for one zbb record.
 *
 * sink callbacks:
 *   onEntry({date, id, classCode, eventCode, logType, message})
   *   onInline({name, type, value})
   *   onFirmwareMatches(fwMatches[{name, version}], iloCandidates[{version, date}])
   *     — called once at end(), in the same order extractFirmwareVersions
   *       produces (per-name in FW_NAME_VALUE order, then first iLO match).
   *   onPciCard({name, manufacturer, vendorId, deviceId, subsystemVendorId,
   *              subsystemDeviceId, driverVersion})
   *     — PCI device-table row found in a snapshot (deduplicated by
   *       position; the sink dedupes remaining identity duplicates).
   *   onPlatformSlot({location, manufacturer, model, partNumber,
   *                   sparePartNumber, macAddress, version, empty, emptyLabel})
   *     — platform-inventory slot row (Gen11/Gen12 snapshots).
   *   onSystemIdentity({serialNumber, partNumber, productName})  [optional]
 */
export function createZbbScanner(sink) {
  let win = new Uint8Array(0); // kept tail (carry) of the decompressed stream
  let winAbs = 0;              // absolute offset of win[0] within the record
  let lastEntryRec = -1;       // abs recStart of the last emitted log entry
  let lastPlainRec = -1;       // abs position of the last emitted plain echo entry
  let lastInlineAbs = -1;      // abs offset of the last emitted inline record
  let lastFwAbs = -1;          // abs offset of the last emitted firmware match
  const pciState = { last: -1 };
  let fwMatches = [];
  let iloCandidates = [];
  let iloDone = false; // first iLO version string recorded (original stops there)
  let identDone = false; // system identity tuple recorded
  let ended = false;

  function scanIdentity(buf, final) {
    if (identDone || typeof sink.onSystemIdentity !== "function") {
      return { stop: -1 };
    }
    const n = buf.length;
    let pos = 0;
    while (pos < n) {
      const i = indexOfSeq(buf, IDENT_NEEDLE, pos);
      if (i < 0) break;
      if (!final && n - i < IDENT_LOOKUP) {
        return { stop: i }; // wait for the full tuple bytes
      }
      const identity = parseIdentityAt(buf, i);
      if (identity) {
        identDone = true;
        sink.onSystemIdentity(identity);
        return { stop: -1 };
      }
      pos = i + 1; // false-positive "HPE\0": keep scanning
    }
    return { stop: -1 };
  }

  /** @returns {{stop: number}} relative position to keep from, or -1 */
  function scanLogEntries(buf, base, final) {
    const n = buf.length;
    let pos = 0;
    while (pos < n) {
      const i = buf.indexOf(SLASH, pos);
      if (i < 0) break;
      const dateStart = i - 2;
      if (dateStart >= 18 && matchDate(buf, dateStart) && buf[dateStart - 18] === 0x03) {
        const variant = logVariantAt(buf, dateStart);
        if (variant !== null) {
          const p = dateStart + 20; // date + null terminator
          if (p + 2 > n) {
            if (!final) return { stop: dateStart - 28 };
            // Truncated at record end: the whole-buffer original would read
            // an empty message and drop the entry — do the same.
            pos = dateStart + 19;
            continue;
          }
          const msgStart = p + 2;
          const msgEnd = findMessageEnd(buf, msgStart);
          if (msgEnd < n || final) {
            const message = latin1(buf, msgStart, msgEnd).trim();
            const absRec = base + dateStart;
            if (message && absRec > lastEntryRec) {
              lastEntryRec = absRec;
              const echo = variant === 0x1a;
              sink.onEntry({
                date: latin1(buf, dateStart, dateStart + 19),
                id: u16le(buf, p),
                classCode: u16le(buf, dateStart - 16),
                eventCode: u16le(buf, dateStart - 14),
                // IML tab = the error log (type 0x0B); Event Logs tab = the
                // iLO Event Log / IEL (type 0x0C); plain echo copies (0x1A)
                // are IML entries too (deduped by the sink).
                logType: variant === 0x0c ? "iel" : "iml",
                message,
                ...(echo ? { echo: true } : {}),
              });
            }
            pos = dateStart + 19;
          } else {
            return { stop: dateStart - 28 };
          }
        } else {
          pos = dateStart + 19;
        }
      } else {
        pos = i + 1;
      }
    }
    return { stop: -1 };
  }

  /**
   * Plain-text echo entries (no 18 0D marker): iLO serializes each log entry
   * a second time as inline text. The date field may be invalid or absent —
   * those entries must still be surfaced, so the raw string is kept and the
   * model derives a null timestamp for them.
   * @returns {{stop: number}} relative position to keep from, or -1
   */
  function scanPlainEntries(buf, base, final) {
    const n = buf.length;
    let pos = 0;
    while (pos < n) {
      const marker = indexOfSeq(buf, PLAIN_NEEDLE, pos);
      if (marker < 0) break;
      const r = marker + 2; // position of the 0x0D marker
      if (r + 31 > n && !final) return { stop: r - 2 };
      const parsed = parseBlock(buf, r);
      if (!parsed) {
        if (!final) return { stop: r - 2 };
        pos = r + 1;
        continue;
      }
      const msgEnd = findMessageEnd(buf, parsed.msgStart);
      if (msgEnd >= n && !final) return { stop: r - 2 };
      pos = parsed.msgStart;
      // echo copies with a valid timestamp are captured by the belt loop;
      // the plain pass only adds the dateless ones
      if (matchDate(buf, parsed.dateStart)) continue;
      const abs = base + r;
      if (abs > lastPlainRec) {
        lastPlainRec = abs;
        sink.onEntry(parsed.entry);
      }
    }
    return { stop: -1 };
  }

  function scanInline(buf, base, final) {
    const n = buf.length;
    let off = 0;
    while (off + 5 <= n) {
      if (buf[off] !== 0x18 || buf[off + 1] !== 0x0d) {
        off++;
        continue;
      }
      const type = buf[off + 2];
      const len = buf[off + 3];
      if (off + 5 + len > n) {
        if (final) break; // whole-buffer original: break
        return { stop: off };
      }
      const nameStart = off + 5;
      const nameEnd = nameStart + len - 4;
      if (nameEnd <= nameStart) {
        off++;
        continue;
      }
      const name = latin1(buf, nameStart, nameEnd).replace(/\0.*$/, "");
      let valStart = nameEnd;
      while (valStart < n && buf[valStart] === 0) valStart++;
      let valEnd = valStart;
      while (valEnd < n && buf[valEnd] !== 0) valEnd++;
      if (valEnd === n && !final) {
        return { stop: off }; // value may continue in the next chunk
      }
      const value = latin1(buf, valStart, valEnd);
      if (name && value !== "") {
        const abs = base + off;
        if (abs > lastInlineAbs) {
          lastInlineAbs = abs;
          sink.onInline({ name, type, value });
        }
      }
      off = valEnd + 1;
    }
    return { stop: -1 };
  }

  function scanFirmware(buf, base, final) {
    const n = buf.length;
    let pos = 0;
    while (pos < n) {
      // earliest needle occurrence at/after pos (document order); once an iLO
      // version string has been recorded, stop looking for more (the
      // whole-buffer original also stops at its first regex match)
      let best = null;
      for (const f of FW_NEEDLES) {
        const i = indexOfSeq(buf, f.needle, pos);
        if (i >= 0 && (best === null || i < best.i)) best = { i, ...f };
      }
      if (!iloDone) {
        const ilo = indexOfSeq(buf, ILO_NEEDLE, pos);
        if (ilo >= 0 && (best === null || ilo < best.i)) {
          best = { i: ilo, needle: ILO_NEEDLE, ilo: true };
        }
      }
      if (best === null) break;
      const { i, needle } = best;
      const after = i + needle.length;
      // Advance by 1 (not by needle.length): needles can be nested (e.g.
      // "System ROM" occurs inside "Redundant System ROM") and the
      // whole-buffer original scans every needle independently from 0.
      const next = i + 1;
      if (best.ilo) {
        let e = i;
        while (e < n && e - i < 80 && buf[e] !== 0 && buf[e] >= 0x20) e++;
        if (e === n && !final) return { stop: i };
        const m = ILO_RE.exec(latin1(buf, i, e));
        if (m) {
          const abs = base + i;
          if (abs > lastFwAbs) {
            lastFwAbs = abs;
            iloCandidates.push({ version: m[1], date: m[2] });
            iloDone = true;
          }
        }
        pos = next;
      } else {
        if (after >= n) {
          if (final) {
            pos = next; // buf[after] undefined !== 0 -> skipped (as the original)
            continue;
          }
          return { stop: i };
        }
        if (buf[after] === 0) {
          const v = after + 1;
          let e = v;
          while (e < n && buf[e] >= 0x20 && buf[e] < 0x7f) e++;
          if (e === n && !final) return { stop: i };
          const version = latin1(buf, v, e).trim();
          const abs = base + i;
          if (version && abs > lastFwAbs) {
            lastFwAbs = abs;
            fwMatches.push({ name: best.name, version });
          }
        }
        pos = next;
      }
    }
    return { stop: -1 };
  }

  function process(final) {
    const buf = win;
    const base = winAbs;
    const n = buf.length;
    const rEntry = scanLogEntries(buf, base, final);
    const rPlain = scanPlainEntries(buf, base, final);
    const rInline = scanInline(buf, base, final);
    const rFw = scanFirmware(buf, base, final);
    const rIdent = scanIdentity(buf, final);
    const pci =
      typeof sink.onPciCard === "function"
        ? scanPciCardTable(buf, base, final, sink, pciState)
        : { stop: -1 };
    const slots =
      typeof sink.onPlatformSlot === "function"
        ? scanSlotTable(buf, base, final, sink)
        : { stop: -1 };
    if (final) {
      sink.onFirmwareMatches(fwMatches, iloCandidates);
      return;
    }
    let keep = n - OVERLAP;
    if (keep < 0) keep = 0;
    for (const r of [rEntry, rPlain, rInline, rFw, rIdent, pci, slots]) {
      if (r.stop >= 0 && r.stop < keep) keep = r.stop;
    }
    if (keep > 0) {
      win = buf.slice(keep);
      winAbs += keep;
    }
  }

  return {
    /** Feed the next decompressed chunk of the record. */
    push(chunk) {
      if (ended) throw new Error("Scanner already ended");
      if (!chunk || chunk.length === 0) return;
      win = win.length === 0 ? chunk : concatBytes(win, chunk);
      if (win.length > 512 * 1024 * 1024) {
        throw new Error("zbb scan window exceeded the memory guard");
      }
      process(false);
    },
    /** Flush at the end of the record (end-of-buffer semantics). */
    end() {
      if (ended) return;
      ended = true;
      process(true);
      win = new Uint8Array(0);
    },
  };
}
