// Multi-member gzip decompression on top of DecompressionStream.
//
// Real AHS .zbb payloads concatenate MANY gzip members (hundreds per record).
// zlib's gunzipSync handles that natively, but DecompressionStream
// implementations reject input that continues after the first member ends
// (ERR_TRAILING_JUNK_AFTER_STREAM_END in Node). This module splits the
// payload into members on the fly and yields the concatenated decompressed
// bytes in bounded batches:
//
//   - input: a ReadableStream<Uint8Array> of the compressed record payload
//   - member boundaries are discovered by scanning for the gzip magic
//     (1f 8b 08) and validated by trial decompression (DS checks the member's
//     CRC32 + ISIZE trailer, so a false positive essentially never passes)
//   - memory: O(member + batch) for multi-member payloads; a single-member
//     payload is buffered whole (identical to the original implementation)
//   - trailing junk after the last member is tolerated, matching gunzipSync
//
// RNF-2: no Buffer, no pako, no node:*.

const MAGIC0 = 0x1f, MAGIC1 = 0x8b, MAGIC2 = 0x08;
const MIN_HEADER = 10; // shortest possible gzip header

function isMagic(u8, i) {
  return u8[i] === MAGIC0 && u8[i + 1] === MAGIC1 && u8[i + 2] === MAGIC2;
}

function concatChunks(chunks, total) {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Growable byte buffer with amortized-O(1) append and cheap front-trim. */
class DynBuf {
  constructor() {
    this.buf = new Uint8Array(64 * 1024);
    this.len = 0;
  }
  ensure(extra) {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len), 0);
    this.buf = next;
  }
  append(u8) {
    this.ensure(u8.length);
    this.buf.set(u8, this.len);
    this.len += u8.length;
  }
  trim(n) {
    this.buf.copyWithin(0, n, this.len);
    this.len -= n;
  }
  view() {
    return this.buf.subarray(0, this.len);
  }
}

/**
 * Decompress one standalone gzip member. Returns the decompressed bytes, or
 * null when `bytes` is not a valid complete member (trial validation).
 * Throws when the output exceeds maxOutput (zip-bomb guard).
 * With `tolerant`, input junk after the member end is accepted and the
 * member's output is returned (mirrors gunzipSync's trailing-junk behavior).
 */
async function decompressMember(bytes, maxOutput, tolerant) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream unavailable in this browser");
  }
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  let writeError = null;
  const writeTask = (async () => {
    try {
      await writer.write(bytes);
      await writer.close();
    } catch (err) {
      writeError = err;
    }
  })();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  let readError = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOutput) {
        await reader.cancel();
        const capErr = new Error("Decompressed size exceeds limit");
        capErr.capExceeded = true;
        throw capErr;
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err && err.capExceeded) throw err; // zip-bomb guard is fatal
    readError = err; // invalid/truncated member
  } finally {
    await writeTask;
    try {
      reader.releaseLock();
    } catch {
      // released by cancel()
    }
  }
  if (readError || writeError) {
    if (tolerant && total > 0) return concatChunks(chunks, total);
    return null;
  }
  return concatChunks(chunks, total);
}

/**
 * Stream-decompress a (possibly multi-member) gzip payload.
 *
 * @param {ReadableStream<Uint8Array>} input compressed payload stream
 * @param {{maxOutput: number, batchBytes?: number, onRead?: (consumed:number) => void}} opts
 *   onRead reports the cumulative number of compressed bytes consumed.
 * @returns {AsyncGenerator<Uint8Array>} decompressed batches (>= batchBytes except the last)
 */
export async function* decompressGzipMembers(input, { maxOutput, batchBytes = 8 * 1024 * 1024, onRead } = {}) {
  const inputReader = input.getReader();
  const pending = new DynBuf();
  let consumedAbs = 0;
  let inputDone = false;
  let totalOut = 0;
  let scanFrom = 0; // pending-relative offset to resume the magic scan
  let attempted = false;
  let batch = [];
  let batchLen = 0;

  try {
    while (true) {
      if (!inputDone) {
        const { done, value } = await inputReader.read();
        if (done) {
          inputDone = true;
        } else {
          pending.append(value);
          consumedAbs += value.byteLength;
          onRead?.(consumedAbs);
        }
      }

      const view = pending.view();
      if (view.length === 0) {
        if (inputDone) break;
        continue;
      }
      if (view.length >= 3 && !isMagic(view, 0)) {
        if (totalOut > 0) break; // trailing junk: tolerate (zlib semantics)
        throw new Error("Not a gzip stream");
      }

      // next magic candidate at/after scanFrom (and after the member header);
      // native single-byte indexOf skips to candidates at memchr speed
      let cand = -1;
      let i = view.indexOf(MAGIC0, Math.max(MIN_HEADER, scanFrom));
      while (i >= 0 && i + 3 <= view.length) {
        if (isMagic(view, i)) {
          cand = i;
          break;
        }
        i = view.indexOf(MAGIC0, i + 1);
      }

      if (cand >= 0 || inputDone) {
        attempted = true;
        const end = cand >= 0 ? cand : view.length;
        const out = await decompressMember(
          view.subarray(0, end),
          maxOutput - totalOut,
          cand < 0 && totalOut > 0
        );
        if (out !== null) {
          totalOut += out.length;
          if (out.length > 0) {
            batch.push(out);
            batchLen += out.length;
            if (batchLen >= batchBytes) {
              yield concatChunks(batch, batchLen);
              batch = [];
              batchLen = 0;
            }
          }
          pending.trim(end);
          scanFrom = 0;
          continue;
        }
        if (cand >= 0) {
          scanFrom = cand + 1; // false positive inside the current member
          continue;
        }
        // final member failed at end-of-input
        if (totalOut > 0) break; // trailing junk: tolerate
        throw new Error("gunzip failed");
      }
      // else: need more input to find the member boundary
    }
    if (batchLen > 0) yield concatChunks(batch, batchLen);
    if (!attempted && totalOut === 0) throw new Error("gunzip failed");
  } finally {
    if (!inputDone) {
      try {
        await inputReader.cancel();
      } catch {
        // already errored/closed
      }
    }
  }
}

/** Wrap an ArrayBuffer into a one-chunk ReadableStream (env-agnostic). */
export function singleChunkStream(buffer) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}
