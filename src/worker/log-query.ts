// Query engine for the resident log tabs (RNF-5): filtering and pagination
// over the IML / Event Log arrays, executed inside the worker.
//
// - Severity index: one Uint8Array per tab, built once when the analysis
//   finishes (1 byte/row).
// - Filtered row index: Int32Array of matching row positions, built lazily
//   on the first query for a given criteria and cached (LRU) so paging
//   through results is O(page) instead of O(rows).

import type { LogFilter, LogRow } from "../types";

export const PAGE_SIZE = 500;
const CACHE_MAX = 4;

export interface LogEntryLike {
  date: string;
  severity: string;
  message: string;
  alarm: string;
  classCode: number;
  eventCode: number;
}

export function severityCode(sev: string): number {
  return sev === "critical" ? 2 : sev === "warning" ? 1 : 0;
}

export function buildSeverityIndex(list: { severity: string }[]): Uint8Array {
  const out = new Uint8Array(list.length);
  for (let i = 0; i < list.length; i++) {
    out[i] = severityCode(list[i].severity);
  }
  return out;
}

export class LogQueryEngine {
  private iml: LogEntryLike[];
  private events: LogEntryLike[];
  private severityIndex: { iml: Uint8Array; events: Uint8Array };
  private cache = new Map<string, Int32Array>();

  constructor(iml: LogEntryLike[], events: LogEntryLike[]) {
    this.iml = iml;
    this.events = events;
    this.severityIndex = {
      iml: buildSeverityIndex(iml),
      events: buildSeverityIndex(events),
    };
  }

  private cacheSet(key: string, val: Int32Array) {
    this.cache.set(key, val);
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  /** Build (or reuse) the filtered row-index for one tab + criteria. */
  filteredIndex(tab: "iml" | "events", filter: LogFilter): Int32Array {
    const key = `${tab}|${filter.severity}|${filter.text.trim().toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const list = tab === "iml" ? this.iml : this.events;
    const sevIdx = this.severityIndex[tab];
    const wantSev = filter.severity === "all" ? -1 : severityCode(filter.severity);
    const q = filter.text.trim().toLowerCase();

    const out = new Int32Array(list.length);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (wantSev >= 0 && sevIdx[i] !== wantSev) continue;
      if (q !== "" && !list[i].message.toLowerCase().includes(q)) continue;
      out[n++] = i;
    }
    const idx = new Int32Array(out.subarray(0, n));
    this.cacheSet(key, idx);
    return idx;
  }

  /** One page of rows for a tab + criteria. Rows never leave the worker except here. */
  queryRows(
    tab: "iml" | "events",
    filter: LogFilter,
    page: number
  ): { rows: LogRow[]; total: number } {
    const idx = this.filteredIndex(tab, filter);
    const list = tab === "iml" ? this.iml : this.events;
    const start = page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, idx.length);
    const rows: LogRow[] = [];
    for (let p = start; p < end; p++) {
      const e = list[idx[p]];
      rows.push({
        date: e.date,
        severity: e.severity as LogRow["severity"],
        message: e.message,
        alarm: e.alarm,
        classCode: e.classCode,
        eventCode: e.eventCode,
      });
    }
    return { rows, total: idx.length };
  }
}
