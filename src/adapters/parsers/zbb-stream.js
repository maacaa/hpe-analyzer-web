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
import { matchDate, FW_NAME_VALUE } from "./zbb.js";

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
 *   onSystemIdentity({serialNumber, partNumber, productName})  [optional]
 */
export function createZbbScanner(sink) {
  let win = new Uint8Array(0); // kept tail (carry) of the decompressed stream
  let winAbs = 0;              // absolute offset of win[0] within the record
  let lastEntryRec = -1;       // abs recStart of the last emitted log entry
  let lastInlineAbs = -1;      // abs offset of the last emitted inline record
  let lastFwAbs = -1;          // abs offset of the last emitted firmware match
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
      if (dateStart >= 0 && matchDate(buf, dateStart)) {
        const recStart = dateStart - 23;
        if (recStart >= 0 && buf[recStart] === 0x18 && buf[recStart + 1] === 0x0d) {
          const p = dateStart + 20; // date + null terminator
          if (p + 2 > n) {
            if (!final) return { stop: recStart };
            // Truncated at record end: the whole-buffer original would read
            // an empty message and drop the entry — do the same.
            pos = dateStart + 19;
            continue;
          }
          const msgStart = p + 2;
          const msgEnd = findMessageEnd(buf, msgStart);
          if (msgEnd < n || final) {
            const message = latin1(buf, msgStart, msgEnd).trim();
            const absRec = base + recStart;
            if (message && absRec > lastEntryRec) {
              lastEntryRec = absRec;
              const type = buf[recStart + 2];
              sink.onEntry({
                date: latin1(buf, dateStart, dateStart + 19),
                id: u16le(buf, p),
                classCode: u16le(buf, recStart + 7),
                eventCode: u16le(buf, recStart + 9),
                logType: type === 0x0b ? "iml" : type === 0x0c ? "iel" : "unknown",
                message,
              });
            }
            pos = dateStart + 19;
          } else {
            return { stop: recStart };
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
    const rInline = scanInline(buf, base, final);
    const rFw = scanFirmware(buf, base, final);
    const rIdent = scanIdentity(buf, final);
    if (final) {
      sink.onFirmwareMatches(fwMatches, iloCandidates);
      return;
    }
    let keep = n - OVERLAP;
    if (keep < 0) keep = 0;
    for (const r of [rEntry, rInline, rFw, rIdent]) {
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
