import { describe, it, expect } from "vitest";
import { readAhsRecordsBrowser, listAhsRecordsBrowser } from "../../adapters/parsers/ahs-browser.js";
import { buildRecord, u8concat } from "../helpers.js";

function bytesToFile(buffer, name = "test.ahs") {
  return new File([buffer], name, { type: "application/octet-stream" });
}

describe("readAhsRecordsBrowser", () => {
  it("iterates records and decompresses gzip entries", async () => {
    const records = [
      await buildRecord("CUST_INFO.DAT", new TextEncoder().encode("cust")),
      await buildRecord("0000001-2024-01-01.zbb", new TextEncoder().encode("blackbox-data"), {
        gzip: true,
      }),
      await buildRecord("file.pkg", new TextEncoder().encode("listing")),
    ];
    const file = bytesToFile(u8concat(...records));

    const names = [];
    for await (const rec of readAhsRecordsBrowser(file)) {
      names.push(rec.name);
      if (rec.name.endsWith(".zbb")) {
        expect(new TextDecoder().decode(rec.data)).toBe("blackbox-data");
      }
    }
    expect(names).toEqual([
      "CUST_INFO.DAT",
      "0000001-2024-01-01.zbb",
      "file.pkg",
    ]);
  });

  it("listAhsRecordsBrowser returns metadata without payloads", async () => {
    const records = [
      await buildRecord("CUST_INFO.DAT", new TextEncoder().encode("abc")),
      await buildRecord("a.zbb", new TextEncoder().encode("zzz"), { gzip: true }),
    ];
    const file = bytesToFile(u8concat(...records));
    const list = await listAhsRecordsBrowser(file);
    expect(list).toHaveLength(2);
    expect(list[1].decompressed).toBe(3);
  });

  it("throws on truncated header", async () => {
    const file = bytesToFile(new Uint8Array(50));
    await expect(async () => {
      for await (const _rec of readAhsRecordsBrowser(file)) void _rec;
    }).rejects.toThrow(/truncated/i);
  });
});
