import { describe, it, expect } from "vitest";
import {
  LogQueryEngine,
  buildSeverityIndex,
  PAGE_SIZE,
} from "../../worker/log-query.js";
import type { LogEntryLike } from "../../worker/log-query.js";

function entry(i: number, severity: string, message: string): LogEntryLike {
  return {
    date: `01/02/2024 ${String(i % 24).padStart(2, "0")}:00:00`,
    severity,
    message,
    alarm: message,
    classCode: 0x000a,
    eventCode: i,
  };
}

function buildModel(): { iml: LogEntryLike[]; events: LogEntryLike[] } {
  const iml: LogEntryLike[] = [];
  const events: LogEntryLike[] = [];
  for (let i = 0; i < PAGE_SIZE * 2 + 10; i++) {
    // deterministic mix: every 5th critical, every 3rd warning, rest info
    const sev = i % 5 === 0 ? "critical" : i % 3 === 0 ? "warning" : "information";
    iml.push(entry(i, sev, `IML message ${i} about processor`));
    events.push(entry(i, sev, `Event message ${i} about session`));
  }
  return { iml, events };
}

describe("buildSeverityIndex", () => {
  it("maps severities to 1-byte codes", () => {
    const idx = buildSeverityIndex([
      { severity: "information" },
      { severity: "warning" },
      { severity: "critical" },
    ]);
    expect([...idx]).toEqual([0, 1, 2]);
  });
});

describe("LogQueryEngine", () => {
  const model = buildModel();

  it("no filter: all rows, paged in PAGE_SIZE chunks", () => {
    const e = new LogQueryEngine(model.iml, model.events);
    const p0 = e.queryRows("iml", { severity: "all", text: "" }, 0);
    expect(p0.total).toBe(model.iml.length);
    expect(p0.rows).toHaveLength(PAGE_SIZE);
    expect(p0.rows[0].message).toContain("IML message 0");

    const p2 = e.queryRows("iml", { severity: "all", text: "" }, 2);
    expect(p2.rows).toHaveLength(10); // 2*PAGE_SIZE+10 -> last page partial
  });

  it("severity filter matches the manual count", () => {
    const e = new LogQueryEngine(model.iml, model.events);
    const criticals = model.iml.filter((x) => x.severity === "critical").length;
    const res = e.queryRows("iml", { severity: "critical", text: "" }, 0);
    expect(res.total).toBe(criticals);
    expect(res.rows.every((r) => r.severity === "critical")).toBe(true);
  });

  it("text search is case-insensitive over message", () => {
    const e = new LogQueryEngine(model.iml, model.events);
    const res = e.queryRows("iml", { severity: "all", text: "PROCESSOR 7 " }, 0);
    const expected = model.iml.filter((x) =>
      x.message.toLowerCase().includes("processor 7")
    ).length;
    expect(res.total).toBe(expected);
  });

  it("combined severity + text filter", () => {
    const e = new LogQueryEngine(model.iml, model.events);
    const res = e.queryRows("iml", { severity: "critical", text: "processor" }, 0);
    const expected = model.iml.filter(
      (x) => x.severity === "critical" && x.message.toLowerCase().includes("processor")
    ).length;
    expect(res.total).toBe(expected);
  });

  it("pagination covers every row exactly once", () => {
    const e = new LogQueryEngine(model.iml, model.events);
    const seen: number[] = [];
    let page = 0;
    while (true) {
      const res = e.queryRows("iml", { severity: "all", text: "" }, page++);
      if (res.rows.length === 0) break;
      for (const r of res.rows) {
        seen.push(Number(/(\d+) about/.exec(r.message)![1]));
      }
    }
    expect(seen).toHaveLength(model.iml.length);
    expect(new Set(seen).size).toBe(model.iml.length);
  });

  it("caches the filtered index per criteria (LRU, max 4)", () => {
    const e = new LogQueryEngine(model.iml, model.events);
    const a = e.filteredIndex("iml", { severity: "critical", text: "" });
    expect(e.filteredIndex("iml", { severity: "critical", text: "" })).toBe(a);
    // evict by inserting 4 more criteria
    e.filteredIndex("iml", { severity: "warning", text: "" });
    e.filteredIndex("iml", { severity: "all", text: "processor" });
    e.filteredIndex("events", { severity: "all", text: "session" });
    e.filteredIndex("iml", { severity: "all", text: "zzz" });
    const rebuilt = e.filteredIndex("iml", { severity: "critical", text: "" });
    expect(rebuilt).not.toBe(a);
    expect([...rebuilt]).toEqual([...a]);
  });

  it("tabs are independent", () => {
    const e = new LogQueryEngine(model.iml, model.events);
    const imlRes = e.queryRows("iml", { severity: "all", text: "session" }, 0);
    expect(imlRes.total).toBe(0);
    const evRes = e.queryRows("events", { severity: "all", text: "session" }, 0);
    expect(evRes.total).toBe(model.events.length);
  });
});
