import type { Severity } from "../types";
import { LogListTab } from "./LogListTab";
import type { AnalyzerClient } from "../api/worker-client";

export function ImlTab({ client }: { client: AnalyzerClient }) {
  return (
    <LogListTab
      title="Integrated Management Log"
      tab="iml"
      client={client}
      showCode
      searchPlaceholder="Search messages…"
    />
  );
}

export function SevBadge({ sev }: { sev: Severity }) {
  return <span className={`sev sev-${sev}`}>{sev}</span>;
}
