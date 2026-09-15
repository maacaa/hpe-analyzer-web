// Memory benchmark (RNF-7): run analyzeWebStreaming over a large real AHS
// file WITHOUT loading it into memory (lazy File shim over a file descriptor,
// mirroring browser File.slice semantics) and assert the JS heap stays flat
// and under the 500 MB threshold.
//
// Usage: node --expose-gc scripts/mem-bench.mjs [path-to-ahs]
// Exit code 1 when the heap threshold is exceeded.

import fs from "node:fs";
import path from "node:path";
import { analyzeWebStreaming } from "../src/adapters/delivery/analyzer-stream.js";

const HEAP_LIMIT_MB = 500;

/** Minimal File-like object reading from disk on demand (O(slice) memory). */
function lazyFile(filePath) {
  const fd = fs.openSync(filePath, "r");
  const stat = fs.fstatSync(fd);
  const file = {
    name: path.basename(filePath),
    size: stat.size,
    lastModified: stat.mtimeMs,
    slice(start, end) {
      const s = Math.max(0, Math.min(start, stat.size));
      const e = Math.max(s, Math.min(end, stat.size));
      const length = e - s;
      let pos = s;
      let remaining = length;
      const readChunk = async (buf) => {
        if (remaining <= 0) return { done: true, value: undefined };
        const n = Math.min(buf.length, remaining);
        const tmp = new Uint8Array(n);
        const bytesRead = fs.readSync(fd, tmp, 0, n, pos);
        pos += bytesRead;
        remaining -= bytesRead;
        return { done: false, value: tmp.subarray(0, bytesRead) };
      };
      return {
        arrayBuffer: async () => {
          const out = new Uint8Array(length);
          let off = 0;
          while (off < length) {
            const n = Math.min(1 << 20, length - off);
            const bytesRead = fs.readSync(fd, out, off, n, pos);
            pos += bytesRead;
            off += bytesRead;
          }
          return out.buffer;
        },
        stream: new ReadableStream({
          async pull(controller) {
            const CHUNK = 1 << 20;
            if (remaining <= 0) {
              controller.close();
              return;
            }
            const n = Math.min(CHUNK, remaining);
            const tmp = new Uint8Array(n);
            const bytesRead = fs.readSync(fd, tmp, 0, n, pos);
            pos += bytesRead;
            remaining -= bytesRead;
            controller.enqueue(tmp.subarray(0, bytesRead));
          },
        }),
      };
    },
  };
  return file;
}

function formatMB(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const fileArg = process.argv[2] ?? "AHS files/HPE_CZ20070LKM_20241009 (2).ahs";
const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const file = lazyFile(filePath);
console.log(`File: ${file.name}  ${formatMB(file.size)}`);

let peakHeap = 0;
let peakRss = 0;
const samples = [];
const timer = setInterval(() => {
  if (globalThis.gc) globalThis.gc();
  const m = process.memoryUsage();
  peakHeap = Math.max(peakHeap, m.heapUsed);
  peakRss = Math.max(peakRss, m.rss);
  samples.push(m.heapUsed);
}, 250);

const t0 = performance.now();
let lastPct = -1;
const model = await analyzeWebStreaming(file, (p) => {
  const pct = Math.floor(p.pct);
  if (pct >= lastPct + 20) {
    lastPct = pct;
    console.log(
      `  ${String(pct).padStart(3)}%  phase=${p.phase}  heap=${formatMB(process.memoryUsage().heapUsed)}`
    );
  }
});
clearInterval(timer);
const secs = ((performance.now() - t0) / 1000).toFixed(1);

console.log(`Done in ${secs}s`);
console.log(`Peak heapUsed: ${formatMB(peakHeap)}  (limit ${HEAP_LIMIT_MB} MB)`);
console.log(`Peak RSS     : ${formatMB(peakRss)}`);
console.log(
  "Stats:",
  JSON.stringify(model.stats),
  `| fw ${model.firmware.length} | hw ${model.hardware.length} | rca ${model.rca.length}`
);

if (peakHeap > HEAP_LIMIT_MB * 1048576) {
  console.error(`FAIL: heap exceeded the ${HEAP_LIMIT_MB} MB threshold`);
  process.exit(1);
}
console.log("PASS: memory stayed within the threshold");
