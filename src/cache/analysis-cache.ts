// IndexedDB cache for completed analyses (RF-12).
//
// Key: the cheap file fingerprint (see fingerprint.ts). Value: the full
// analysis model (structured-clone friendly plain objects), so reopening the
// same file is instant and the resident worker can serve IML/Event queries
// without re-parsing. Bounded: the oldest analyses are evicted beyond
// MAX_ENTRIES.

const DB_NAME = "hpe-analyzer-web";
// v2: hardware issues + board firmware/total-memory fields.
// v3: unit-serial fix (PCASerialNumber no longer reported as the unit serial).
// v4: invalidate models cached before the critical-severity/RCA fix — stale
// entries would keep showing 0 critical events without ever recomputing.
// v5: plain-text echo entries (belt-only parsing missed IML entries) +
// hardware fault attribution for system board/power supplies/memory.
const DB_VERSION = 5;
const STORE = "analyses";
export const MAX_ENTRIES = 6;

/**
 * Analyzer pipeline version: bumped whenever the parse/analysis output changes
 * in a way that older cached models do not contain (see DB_VERSION history).
 * Cached models produced by an older pipeline are ignored on get() — the
 * caller re-analyzes the file and overwrites the entry.
 */
export const PIPELINE_VERSION = 5;

export interface CachedAnalysis {
  fingerprint: string;
  name: string;
  size: number;
  analyzedAt: number;
  pipelineVersion?: number;
  model: unknown;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Version bump: drop every cached model so stale analyses (e.g. computed
      // before the critical-severity fix) are never served again.
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      db.createObjectStore(STORE, { keyPath: "fingerprint" });
    };
    // A schema upgrade while another tab keeps its IDB connection open would
    // block forever. The cache is best-effort: fail fast and let the caller
    // fall back to a full re-analysis instead of hanging.
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;
    req.onblocked = () => {
      blockedTimer = setTimeout(() => {
        reject(new Error("cache blocked by another open tab"));
      }, 2000);
    };
    req.onsuccess = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
  });
}

export class AnalysisCache {
  /**
   * Cached models produced by an older analysis pipeline (PIPELINE_VERSION)
   * are treated as missing: they would silently omit events/features added
   * later, so the caller must re-analyze the file instead.
   */
  async get(fingerprint: string): Promise<CachedAnalysis | null> {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(fingerprint);
        req.onsuccess = () => {
          const cached = (req.result as CachedAnalysis) ?? null;
          if (cached?.pipelineVersion !== PIPELINE_VERSION) {
            resolve(null);
            return;
          }
          resolve(cached);
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
      });
    } finally {
      db.close();
    }
  }

  async put(entry: CachedAnalysis): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      await this.evictOld(tx);
      await txDone(tx);
    } finally {
      db.close();
    }
  }

  private async evictOld(tx: IDBTransaction): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result as CachedAnalysis[]) ?? [];
        if (all.length > MAX_ENTRIES) {
          const oldest = all
            .sort((a, b) => a.analyzedAt - b.analyzedAt)
            .slice(0, all.length - MAX_ENTRIES);
          for (const e of oldest) {
            tx.objectStore(STORE).delete(e.fingerprint);
          }
        }
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB getAll failed"));
    });
  }
}
