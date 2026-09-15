// ABJR container parser — browser edition.
//
// Reads AHS records from a browser File object via the File API (no node:fs,
// no node:zlib, no pako). Decompresses gzip records via DecompressionStream
// with multi-member support (gzip-members.js).

import { decompressGzipMembers, singleChunkStream } from "./gzip-members.js";
// Fase 1 will replace whole-record reads with chunked streaming; this edition
// keeps the same caps and yields the same record shapes.

const MAGIC = new Uint8Array([0x41, 0x42, 0x4a, 0x52]); // "ABJR"
const HEADER_SIZE = 116;
const NAME_OFFSET = 20;
const NAME_SIZE = 32;

// Security limits for untrusted AHS files (RNF-6).
export const MAX_RECORD_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB on disk
export const MAX_DECOMPRESSED = 128 * 1024 * 1024; // 128 MiB per record
export const MAX_TOTAL_DECOMPRESSED = 8 * 1024 * 1024 * 1024; // 8 GiB per file

const GZIP_NAMES = new Set(["bcert.pkg"]);

export function isGzip(name) {
  return GZIP_NAMES.has(name) || name.endsWith(".zbb") || name.endsWith(".bb");
}

async function readBytes(file, offset, length) {
  const slice = file.slice(offset, offset + length);
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}

function toLittleEndian32(arr, offset) {
  return (
    arr[offset] |
    (arr[offset + 1] << 8) |
    (arr[offset + 2] << 16) |
    (arr[offset + 3] << 24)
  ) >>> 0;
}

/**
 * Parse the 116-byte record header.
 * @param {Uint8Array} arr
 * @returns {{name:string, size:number, bits:number, checksum:number, large:Uint8Array, error?:string}}
 */
export function parseHeader(arr) {
  if (arr.length < HEADER_SIZE) {
    throw new Error("Truncated header");
  }
  for (let i = 0; i < 4; i++) {
    if (arr[i] !== MAGIC[i]) throw new Error("Bad magic");
  }
  const size = toLittleEndian32(arr, 8);
  const bits = toLittleEndian32(arr, 16);
  const checksum = toLittleEndian32(arr, 112);
  let name = "";
  for (let i = NAME_OFFSET; i < NAME_OFFSET + NAME_SIZE; i++) {
    if (arr[i] === 0) break;
    name += String.fromCharCode(arr[i]);
  }
  const large = arr.slice(52, 112);
  return { name, size, bits, checksum, large };
}

/**
 * Gunzip a Uint8Array via DecompressionStream with the per-record cap.
 * Handles multi-member gzip payloads (real .zbb records concatenate many
 * members; see gzip-members.js) and tolerates trailing junk like gunzipSync.
 */
async function gunzip(input, maxOutput = MAX_DECOMPRESSED) {
  const chunks = [];
  let total = 0;
  for await (const chunk of decompressGzipMembers(singleChunkStream(input), { maxOutput })) {
    total += chunk.byteLength;
    chunks.push(chunk);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Iterate over every record in an AHS File object.
 * Reads headers and payloads on demand to avoid loading the entire file.
 *
 * @param {File} file
 * @returns {AsyncGenerator<{name:string, size:number, bits:number, checksum:number, large:Uint8Array, data:Uint8Array|null, error:string|null, offset:number}, void, void>}
 */
export async function* readAhsRecordsBrowser(file) {
  const total = file.size;
  let offset = 0;
  let totalDecompressed = 0;

  while (offset < total) {
    const headerBuf = await readBytes(file, offset, HEADER_SIZE);
    if (headerBuf.length === 0) break;
    if (headerBuf.length < HEADER_SIZE) {
      throw new Error(`Truncated header at offset ${offset}`);
    }
    const header = parseHeader(headerBuf);
    if (header.size > MAX_RECORD_SIZE) {
      throw new Error(
        `Record "${header.name}" declares implausible size ${header.size} at offset ${offset}`
      );
    }
    const dataStart = offset + HEADER_SIZE;
    const dataEnd = dataStart + header.size;
    if (dataEnd > total) {
      throw new Error(
        `Record "${header.name}" overflows file at offset ${offset}`
      );
    }

    const compressedBuf = await readBytes(file, dataStart, header.size);

    let data = null;
    if (isGzip(header.name)) {
      try {
        data = await gunzip(compressedBuf);
        totalDecompressed += data.length;
        if (totalDecompressed > MAX_TOTAL_DECOMPRESSED) {
          throw new Error("AHS decompressed size exceeds limit");
        }
      } catch (err) {
        data = null;
        header.error = `gunzip failed: ${err.message}`;
      }
    } else {
      data = compressedBuf;
    }

    yield {
      name: header.name,
      size: header.size,
      bits: header.bits,
      checksum: header.checksum,
      large: header.large,
      data,
      error: header.error || null,
      offset,
    };

    offset = dataEnd;
  }
}

/**
 * Read all records into an in-memory summary (names, sizes only).
 */
export async function listAhsRecordsBrowser(file) {
  const records = [];
  for await (const rec of readAhsRecordsBrowser(file)) {
    records.push({
      name: rec.name,
      size: rec.size,
      decompressed: rec.data ? rec.data.length : null,
      bits: rec.bits,
      checksum: rec.checksum,
      error: rec.error,
      offset: rec.offset,
    });
  }
  return records;
}
