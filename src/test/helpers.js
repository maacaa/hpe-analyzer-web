// Test helpers: build synthetic AHS / ZBB byte arrays (browser-safe).
// gzip compression uses the browser CompressionStream via async helpers.

const MAGIC = new Uint8Array([0x41, 0x42, 0x4a, 0x52]); // "ABJR"

const encoder = new TextEncoder();

function asciiBytes(str) {
  return encoder.encode(str);
}

function writeU32LE(u8, off, value) {
  u8[off] = value & 0xff;
  u8[off + 1] = (value >>> 8) & 0xff;
  u8[off + 2] = (value >>> 16) & 0xff;
  u8[off + 3] = (value >>> 24) & 0xff;
}

function writeU16LE(u8, off, value) {
  u8[off] = value & 0xff;
  u8[off + 1] = (value >>> 8) & 0xff;
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Gzip-compress bytes via the browser CompressionStream. */
export async function gzipCompress(data) {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const writePromise = (async () => {
    await writer.write(data);
    await writer.close();
  })();
  const chunks = [];
  const reader = cs.readable.getReader();
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    chunks.push(value);
  }
  await writePromise;
  const out = new Uint8Array(totalSize);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Build a single ABJR container record (116-byte header + payload).
 * Returns a Promise when gzip is requested.
 */
export function buildRecord(name, data, { gzip = false } = {}) {
  const build = (payload) => {
    const header = new Uint8Array(116);
    header.set(MAGIC, 0);
    writeU32LE(header, 4, 0x00020300); // pad1
    writeU32LE(header, 8, payload.length); // size
    writeU32LE(header, 12, 0); // pad2
    writeU32LE(header, 16, 0x80000002); // bits
    header.set(asciiBytes(name).subarray(0, 32), 20); // name
    return concat([header, payload]);
  };
  return gzip ? gzipCompress(data).then(build) : build(data);
}

/**
 * Build a synthetic ZBB log record (old belt generation):
 *   [18 0D <type>] [seq u16] [03 0f] [class u16 @+7] [event u16 @+9]
 *   [len u16] [10 fixed bytes, 01 at +16] [date "MM/DD/YYYY HH:MM:SS" + null]
 *   [id u16] [message]
 */
export function buildLogRecord({
  type = 0x0b,
  classCode = 0x000a,
  eventCode = 0x0469,
  date = "01/02/2024 03:04:05",
  id = 1,
  message = "Test message.",
  terminator = 0,
} = {}) {
  const header = new Uint8Array(23);
  header[0] = 0x18;
  header[1] = 0x0d;
  header[2] = type;
  header[3] = 0xe1; // u16 seq (any value)
  header[5] = 0x03;
  header[6] = 0x0f;
  writeU16LE(header, 7, classCode);
  writeU16LE(header, 9, eventCode);
  writeU16LE(header, 13, message.length + 4); // len field seen in the wild
  header[16] = 0x01;

  return concat([
    header,
    asciiBytes(date),
    new Uint8Array([0]),
    (() => {
      const idBuf = new Uint8Array(2);
      writeU16LE(idBuf, 0, id);
      return idBuf;
    })(),
    asciiBytes(message),
    new Uint8Array([terminator]),
  ]);
}

/** Fixed-width null-padded latin1 field (test equivalent of Buffer.alloc+write). */
export function str0(s, len) {
  const b = new Uint8Array(len);
  b.set(asciiBytes(s).subarray(0, len), 0);
  return b;
}

/** Concatenate Uint8Arrays in tests. */
export function u8concat(...parts) {
  return concat(parts);
}
