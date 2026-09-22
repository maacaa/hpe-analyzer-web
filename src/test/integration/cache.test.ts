// @vitest-environment jsdom
// IndexedDB cache tests (RF-12) using fake-indexeddb.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  AnalysisCache,
  MAX_ENTRIES,
  PIPELINE_VERSION,
  type CachedAnalysis,
} from "../../cache/analysis-cache";
import { fingerprintFile } from "../../cache/fingerprint";

function makeFile(name: string, content: string, lastModified = 1000): File {
  return new File([content], name, {
    type: "application/octet-stream",
    lastModified,
  });
}

/** The worker always tags cached models with the current pipeline version. */
function put(cache: AnalysisCache, entry: Omit<CachedAnalysis, "pipelineVersion">) {
  return cache.put({ ...entry, pipelineVersion: PIPELINE_VERSION });
}

describe("fingerprintFile", () => {
  it("is deterministic for the same file content", async () => {
    const f1 = makeFile("a.ahs", "x".repeat(200_000));
    const f2 = makeFile("a.ahs", "x".repeat(200_000));
    expect(await fingerprintFile(f1)).toBe(await fingerprintFile(f2));
  });

  it("differs by name", async () => {
    expect(await fingerprintFile(makeFile("a.ahs", "data"))).not.toBe(
      await fingerprintFile(makeFile("b.ahs", "data"))
    );
  });

  it("differs by size", async () => {
    expect(await fingerprintFile(makeFile("a.ahs", "data"))).not.toBe(
      await fingerprintFile(makeFile("a.ahs", "data2"))
    );
  });

  it("differs by lastModified", async () => {
    expect(await fingerprintFile(makeFile("a.ahs", "data", 1))).not.toBe(
      await fingerprintFile(makeFile("a.ahs", "data", 2))
    );
  });

  it("differs by tail content beyond the 64 KiB boundary", async () => {
    const big = "a".repeat(200_000);
    const f1 = makeFile("a.ahs", big);
    const f2 = makeFile("a.ahs", big + "diff");
    // same head, same size range but different tail content and size
    expect(await fingerprintFile(f1)).not.toBe(await fingerprintFile(f2));
  });
});

describe("AnalysisCache", () => {
  beforeEach(async () => {
    // fresh database per test
    const dbs = await indexedDB.databases();
    for (const d of dbs) {
      if (d.name === "hpe-analyzer-web" && d.version) {
        indexedDB.deleteDatabase("hpe-analyzer-web");
      }
    }
  });

  it("round-trips a stored model", async () => {
    const cache = new AnalysisCache();
    const model = { meta: { productName: "ProLiant" }, iml: [{ a: 1 }] };
    await put(cache, {
      fingerprint: "fp-1",
      name: "a.ahs",
      size: 10,
      analyzedAt: 1,
      model,
    });
    const got = await cache.get("fp-1");
    expect(got).not.toBeNull();
    expect(got!.name).toBe("a.ahs");
    expect(got!.model).toEqual(model);
  });

  it("returns null for unknown fingerprints", async () => {
    const cache = new AnalysisCache();
    expect(await cache.get("nope")).toBeNull();
  });

  it("treats models cached by an older pipeline version as missing", async () => {
    const cache = new AnalysisCache();
    await cache.put({
      fingerprint: "fp-old",
      name: "a.ahs",
      size: 10,
      analyzedAt: 1,
      pipelineVersion: PIPELINE_VERSION - 1,
      model: { stale: true },
    });
    expect(await cache.get("fp-old")).toBeNull();
  });

  it("overwrites an existing fingerprint", async () => {
    const cache = new AnalysisCache();
    await put(cache, { fingerprint: "fp-1", name: "a.ahs", size: 10, analyzedAt: 1, model: { v: 1 } });
    await put(cache, { fingerprint: "fp-1", name: "a.ahs", size: 10, analyzedAt: 2, model: { v: 2 } });
    const got = await cache.get("fp-1");
    expect(got!.model).toEqual({ v: 2 });
  });

  it(`evicts beyond ${MAX_ENTRIES} entries (oldest first)`, async () => {
    const cache = new AnalysisCache();
    for (let i = 0; i < MAX_ENTRIES + 2; i++) {
      await put(cache, {
        fingerprint: `fp-${i}`,
        name: `f${i}.ahs`,
        size: i,
        analyzedAt: i,
        model: { i },
      });
    }
    expect(await cache.get("fp-0")).toBeNull(); // oldest evicted
    expect(await cache.get("fp-1")).toBeNull();
    expect(await cache.get(`fp-${MAX_ENTRIES + 1}`)).not.toBeNull(); // newest kept
    expect(await cache.get(`fp-${MAX_ENTRIES}`)).not.toBeNull();
  });
});
