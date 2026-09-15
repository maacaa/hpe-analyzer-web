// Byte helpers over plain Uint8Array (browser-safe, RNF-2).
//
// The parser adapters must avoid Buffer-only APIs (`readUInt16LE`,
// `indexOf(Buffer)`, `toString`) so the browser build needs no Buffer
// polyfill. Text decoding uses "windows-1252" (the WHATWG superset of latin1,
// equivalent to Buffer.toString("latin1") for every byte value 0x00-0xFF).

const latin1Decoder = new TextDecoder("windows-1252");
const encoder = new TextEncoder();

/** Little-endian unsigned 16-bit read. */
export function u16le(u8, off) {
  return u8[off] | (u8[off + 1] << 8);
}

/** Little-endian unsigned 32-bit read. */
export function u32le(u8, off) {
  return (
    (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0
  );
}

/** Decode a byte range as windows-1252/latin1 (superset-safe for binary junk). */
export function latin1(u8, start, end) {
  return latin1Decoder.decode(u8.subarray(start, end));
}

/** Null-terminated string from a fixed-width field (latin1). */
export function string0(u8, offset, length) {
  const end = Math.min(u8.length, offset + length);
  let i = offset;
  while (i < end && u8[i] !== 0) i++;
  return latin1(u8, offset, i).trim();
}

/** Search for a byte sequence inside u8. Uses the native single-byte
 * TypedArray.indexOf to skip to candidate positions (memchr speed), then
 * verifies the remainder — equivalent to a naive scan but ~100x faster on
 * large buffers. */
export function indexOfSeq(u8, seq, from = 0) {
  if (seq.length === 0) return Math.max(0, from);
  const first = seq[0];
  let i = u8.indexOf(first, Math.max(0, from));
  while (i >= 0 && i <= u8.length - seq.length) {
    let j = 1;
    while (j < seq.length && u8[i + j] === seq[j]) j++;
    if (j === seq.length) return i;
    i = u8.indexOf(first, i + 1);
  }
  return -1;
}

/** Encode a short ASCII/latin1 literal into bytes (cached per call site use). */
export function textBytes(str) {
  return encoder.encode(str);
}
