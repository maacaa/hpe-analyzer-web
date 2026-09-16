import type { Severity, Summary } from "../types";
import { LogListTab } from "./LogListTab";
import type { AnalyzerClient } from "../api/worker-client";

export function ImlTab({
  client,
  summary,
  onNavigate,
}: {
  client: AnalyzerClient;
  summary?: Summary;
  onNavigate?: (tab: "tips") => void;
}) {
  return (
    <LogListTab
      title="Integrated Management Log"
      tab="iml"
      client={client}
      showCode
      searchPlaceholder="Search messages…"
      summary={summary}
      onNavigate={onNavigate}
    />
  );
}

export function SevBadge({ sev }: { sev: Severity }) {
  return <span className={`sev sev-${sev}`}>{sev}</span>;
}
