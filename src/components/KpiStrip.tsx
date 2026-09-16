import type { Severity, Summary } from "../types";

/**
 * KPI strip shown above the IML Logs toolbar. Gives an at-a-glance view of
 * the error/warning volume: Critical and Warning cards act as severity
 * filters (click to toggle back to "All"), and the Advisories card links
 * to the Tips tab.
 */
export function KpiStrip({
  summary,
  filter,
  onFilterChange,
  onNavigate,
}: {
  summary: Summary;
  filter: Severity | "all";
  onFilterChange: (f: Severity | "all") => void;
  onNavigate: (tab: "tips") => void;
}) {
  const { stats, advisories } = summary;
  const sev = (s: Severity | "all") => (filter === s ? " active" : "");

  return (
    <div className="kpi-row">
      <div className="kpi-card">
        <div className="kpi-value accent">{stats.imlCount}</div>
        <div className="kpi-label">IML Entries</div>
      </div>
      <button
        className={`kpi-card clickable${sev("critical")}`}
        onClick={() => onFilterChange(filter === "critical" ? "all" : "critical")}
        title="Show only critical alarms (click again to clear)"
      >
        <div className="kpi-value critical">{stats.criticalCount}</div>
        <div className="kpi-label">Critical</div>
      </button>
      <button
        className={`kpi-card clickable${sev("warning")}`}
        onClick={() => onFilterChange(filter === "warning" ? "all" : "warning")}
        title="Show warnings only (click again to clear)"
      >
        <div className="kpi-value warning">{stats.warningCount}</div>
        <div className="kpi-label">Warnings</div>
      </button>
      <button
        className="kpi-card clickable"
        onClick={() => onNavigate("tips")}
        title="Open the firmware advisories tab"
      >
        <div className={`kpi-value ${advisories.length > 0 ? "warning" : ""}`}>
          {advisories.length}
        </div>
        <div className="kpi-label">Advisories</div>
      </button>
    </div>
  );
}
