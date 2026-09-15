import { LogListTab } from "./LogListTab";
import type { AnalyzerClient } from "../api/worker-client";

export function EventsTab({ client }: { client: AnalyzerClient }) {
  return (
    <LogListTab
      title="Event Log (iLO Event Log)"
      tab="events"
      client={client}
      searchPlaceholder="Search events…"
    />
  );
}
