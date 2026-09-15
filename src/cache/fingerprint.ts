// Cheap file fingerprint (RF-12): name + size + lastModified + SHA-256 over
// the first and last 64 KiB. Never hashes the whole file (a 4 GB read would
// take longer than the analysis itself).

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 64 * 1024;

function toHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Stable fingerprint for a File. Files with the same name/size/timestamp and
 * identical head+tail content share a fingerprint.
 */
export async function fingerprintFile(file: File): Promise<string> {
  const head = new Uint8Array(
    await file.slice(0, Math.min(HEAD_BYTES, file.size)).arrayBuffer()
  );
  const tailStart = Math.max(0, file.size - TAIL_BYTES);
  const tail = new Uint8Array(
    await file.slice(tailStart, file.size).arrayBuffer()
  );
  const merged = new Uint8Array(head.length + tail.length);
  merged.set(head, 0);
  merged.set(tail, head.length);
  const digest = await crypto.subtle.digest("SHA-256", merged);
  return `${file.name}|${file.size}|${file.lastModified}|${toHex(digest).slice(0, 32)}`;
}
