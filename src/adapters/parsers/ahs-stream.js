// Streaming ABJR container reader (RNF-1).
//
// Yields record headers without materializing payloads; gzip payloads are
// decompressed incrementally (multi-member aware, see gzip-members.js) and
// delivered in batched chunks (~8 MB) so memory stays O(member + chunk),
// not O(record).

import {
  parseHeader,
  isGzip,
  MAX_RECORD_SIZE,
} from "./ahs-browser.js";
import { decompressGzipMembers, singleChunkStream } from "./gzip-members.js";

const HEADER_SIZE = 116;

async function readBytes(file, offset, length) {
  const slice = file.slice(offset, offset + length);
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Iterate over every record header in an AHS File without reading payloads.
 * Throws on bad magic / truncated header / implausible size / overflow,
 * exactly like readAhsRecordsBrowser.
 *
 * @param {File} file
 * @returns {AsyncGenerator<{name:string, size:number, bits:number, checksum:number, large:Uint8Array, offset:number, dataStart:number, dataEnd:number, gzip:boolean}, void, void>}
 */
export async function* readAhsRecordHeaders(file) {
  const total = file.size;
  let offset = 0;
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
    yield {
      name: header.name,
      size: header.size,
      bits: header.bits,
      checksum: header.checksum,
      large: header.large,
      offset,
      dataStart,
      dataEnd,
      gzip: isGzip(header.name),
    };
    offset = dataEnd;
  }
}

/**
 * Stream-decompress one gzip record (possibly multi-member gzip), yielding
 * decompressed chunks batched up to batchBytes. Enforces maxOutput (zip-bomb
 * guard). onRead(consumed) reports cumulative compressed bytes consumed.
 */
export async function* gunzipRecordChunks(
  file,
  dataStart,
  size,
  { maxOutput, batchBytes = 8 * 1024 * 1024, onRead } = {}
) {
  const slice = file.slice(dataStart, dataStart + size);
  const input = typeof slice.stream === "function"
    ? slice.stream()
    : singleChunkStream(await slice.arrayBuffer());
  yield* decompressGzipMembers(input, { maxOutput, batchBytes, onRead });
}

/** Decompress one gzip record fully (for small bounded records, e.g. bcert.pkg). */
export async function gunzipRecord(file, dataStart, size, maxOutput) {
  let out = null;
  let total = 0;
  for await (const chunk of gunzipRecordChunks(file, dataStart, size, { maxOutput })) {
    total += chunk.byteLength;
    if (!out) {
      out = chunk;
    } else {
      const merged = new Uint8Array(total);
      merged.set(out, 0);
      merged.set(chunk, total - chunk.byteLength);
      out = merged;
    }
  }
  return out;
}

/** Read one raw (non-gzip) record payload fully. */
export async function readRecordData(file, dataStart, size) {
  return readBytes(file, dataStart, size);
}
