import { useCallback, useEffect, useRef, useState } from "react";
import type { LogRow, Severity, Summary } from "../types";
import { VirtualList } from "./VirtualList";
import { SevBadge } from "./ImlTab";
import { KpiStrip } from "./KpiStrip";
import { useDebouncedValue } from "../hooks";
import type { AnalyzerClient } from "../api/worker-client";

const PAGE = 500;

const FILTERS: { id: Severity | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "warning", label: "Warning" },
  { id: "information", label: "Information" },
];

/**
 * Shared windowed log table used by the IML and Event Log tabs. The rows
 * never live in the renderer (RNF-4): the worker filters and paginates, and
 * this component fetches ~500-row pages as the viewport approaches the end
 * of the loaded buffer. Severity filter + debounced search (200 ms) are
 * executed inside the worker (RNF-5).
 */
export function LogListTab({
  title,
  tab,
  client,
  showCode = false,
  searchPlaceholder,
  summary,
  onNavigate,
  filter: externalFilter,
  onFilterChange,
}: {
  title: string;
  tab: "iml" | "events";
  client: AnalyzerClient;
  showCode?: boolean;
  searchPlaceholder: string;
  summary?: Summary;
  onNavigate?: (tab: "tips") => void;
  filter?: Severity | "all";
  onFilterChange?: (f: Severity | "all") => void;
}) {
  const [internalFilter, setInternalFilter] = useState<Severity | "all">("all");
  const filter = externalFilter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  const genRef = useRef(0);

  const load = useCallback(
    async (reset: boolean) => {
      const gen = ++genRef.current;
      if (reset) {
        pageRef.current = 0;
        setRows([]);
        setTotal(0);
      }
      loadingRef.current = true;
      try {
        const res = await client.query(
          tab,
          { severity: filter, text: debouncedQuery },
          pageRef.current
        );
        if (gen !== genRef.current) return; // stale response
        setTotal(res.total);
        setRows((prev) => (reset ? res.rows : [...prev, ...res.rows]));
        pageRef.current += 1;
      } catch {
        // worker cancelled/terminated: the UI resets on the next analyze
      } finally {
        loadingRef.current = false;
      }
    },
    [client, tab, filter, debouncedQuery]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const onNearEnd = useCallback(() => {
    if (loadingRef.current) return;
    if (rows.length >= total) return;
    void load(false);
  }, [rows.length, total, load]);

  return (
    <div className="panel panel-fill">
      {summary && onNavigate && (
        <KpiStrip
          summary={summary}
          filter={filter}
          onFilterChange={setFilter}
          onNavigate={onNavigate}
        />
      )}
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="muted">
          {total} total · {rows.length} shown
        </span>
      </div>
      <div className="toolbar">
        <div className="seg">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`seg-btn ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="list-head iml-head">
        <span style={{ width: 160 }}>Date</span>
        <span style={{ width: 110 }}>Severity</span>
        {showCode && <span style={{ width: 90 }}>Code</span>}
        <span style={{ flex: 1 }}>Message</span>
      </div>
      <VirtualList
        items={rows}
        rowHeight={40}
        onNearEnd={onNearEnd}
        render={(e: LogRow) => (
          <div className="iml-row">
            <span className="date" style={{ width: 160 }}>
              {e.date}
            </span>
            <span style={{ width: 110 }}>
              <SevBadge sev={e.severity} />
            </span>
            {showCode && (
              <span className="code" style={{ width: 90 }}>
                {hex(e.classCode)}/{hex(e.eventCode)}
              </span>
            )}
            <span className="msg" style={{ flex: 1 }} title={e.message}>
              {e.alarm || e.message}
            </span>
          </div>
        )}
      />
    </div>
  );
}

function hex(n: number) {
  return "0x" + n.toString(16).padStart(4, "0");
}
