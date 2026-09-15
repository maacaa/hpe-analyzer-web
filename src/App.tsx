import { useCallback, useEffect, useState } from "react";
import type { ProgressInfo, Summary } from "./types";
import type { AnalyzerClient } from "./api/worker-client";
import { saveBinaryFile } from "./api/save";
import { DropZone } from "./components/DropZone";
import { ProgressBar } from "./components/ProgressBar";
import { FirmwareTab } from "./components/FirmwareTab";
import { HardwareTab } from "./components/HardwareTab";
import { ImlTab } from "./components/ImlTab";
import { EventsTab } from "./components/EventsTab";
import { RcaTab } from "./components/RcaTab";
import { TipsTab } from "./components/TipsTab";

type Status = "idle" | "loading" | "done" | "error";

const TABS = [
  { id: "firmware", label: "Firmware" },
  { id: "hardware", label: "Hardware" },
  { id: "iml", label: "IML Logs" },
  { id: "events", label: "Event Logs" },
  { id: "rca", label: "RCA" },
  { id: "tips", label: "Tips" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface RecentEntry {
  name: string;
  fingerprint: string;
  ts: number;
}

function getRecentFiles(): RecentEntry[] {
  try {
    const raw = localStorage.getItem("recent");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentFile(name: string, fingerprint: string) {
  const recent = getRecentFiles().filter((r) => r.fingerprint !== fingerprint);
  recent.unshift({ name, fingerprint, ts: Date.now() });
  if (recent.length > 5) recent.length = 5;
  localStorage.setItem("recent", JSON.stringify(recent));
}

export function App({ client }: { client: AnalyzerClient }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("firmware");
  const [fileName, setFileName] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  useEffect(() => {
    setRecent(getRecentFiles());
  }, []);

  const runAnalysis = useCallback(
    async (file: File) => {
      setStatus("loading");
      setError(null);
      setProgress({ phase: "Starting", done: 0, total: file.size, pct: 0 });
      setSummary(null);
      try {
        const { summary: s, fingerprint, fromCache } = await client.analyze(
          file,
          setProgress
        );
        setSummary(s);
        setStatus("done");
        if (s.rca.length > 0) setActiveTab("rca");
        setProgress(null);
        addRecentFile(file.name, fingerprint);
        setRecent(getRecentFiles());
        if (fromCache) console.info("Loaded from local cache (RF-12)");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        setProgress(null);
      }
    },
    [client]
  );

  const openRecent = useCallback(
    (entry: RecentEntry) => {
      setStatus("loading");
      setError(null);
      setProgress({ phase: "Loading from cache", done: 0, total: 0, pct: 0 });
      setSummary(null);
      client
        .openCached(entry.fingerprint)
        .then(({ summary: s }) => {
          setSummary(s);
          setFileName(entry.name);
          setStatus("done");
          if (s.rca.length > 0) setActiveTab("rca");
          setProgress(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
          setProgress(null);
        });
    },
    [client]
  );

  const onFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      void runAnalysis(file);
    },
    [runAnalysis]
  );

  const onBrowse = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ahs";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        setFileName(file.name);
        void runAnalysis(file);
      }
    };
    input.click();
  }, [runAnalysis]);

  const cancelAnalysis = useCallback(() => {
    // Terminating the worker releases all analysis memory (RNF-11); the
    // pending analyze() promise rejects and the UI returns to idle.
    client.cancel();
    setStatus("idle");
    setProgress(null);
  }, [client]);

  const reset = useCallback(() => {
    client.cancel(); // free the resident model memory as well
    setStatus("idle");
    setSummary(null);
    setFileName(null);
    setError(null);
    setProgress(null);
  }, [client]);

  const exportReport = useCallback(async () => {
    if (status !== "done") return;
    try {
      const pdf = await client.exportReport();
      const ok = await saveBinaryFile(
        "analysis-report.pdf",
        "application/pdf",
        ".pdf",
        pdf
      );
      if (ok) console.info("Report saved (PDF)");
    } catch {
      // export cancelled or failed: nothing to do for the user
    }
  }, [client, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onBrowse();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBrowse]);

  const meta = summary?.meta ?? {};

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" />
          HPE AHS Analyzer
        </div>
        <div className="header-actions">
          <a
            className="btn btn-case"
            href="https://support.hpe.com/connect/s/createcase?client=home"
            target="_blank"
            rel="noreferrer"
            title="Open the HPE Support Center to create a support case"
          >
            Create HPE case
          </a>
          {status === "done" && summary && (
            <div className="server-meta">
              <span>{String(meta.productName ?? "")}</span>
              <span className="muted">SN {String(meta.serialNumber ?? "")}</span>
              <span className="muted">{fileName}</span>
              <button className="btn btn-new" onClick={() => void exportReport()} title="Export a readable analysis report (.txt)">
                Export report
              </button>
              <button className="btn btn-new" onClick={reset}>
                Analyze another file
              </button>
            </div>
          )}
        </div>
      </header>

      {status === "idle" && (
        <>
          <DropZone onFile={onFile} onBrowse={onBrowse} />
          {recent.length > 0 && (
            <div className="recent-panel">
              <div className="recent-title">Recent files</div>
              {recent.map((entry) => (
                <button
                  key={entry.fingerprint}
                  className="recent-item"
                  onClick={() => openRecent(entry)}
                  title="Reopen this analysis from the local cache"
                >
                  {entry.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {status === "loading" && (
        <>
          <ProgressBar progress={progress} />
          <div className="center-panel" style={{ paddingTop: 0 }}>
            <button className="btn" onClick={cancelAnalysis}>
              Cancel
            </button>
          </div>
        </>
      )}

      {status === "error" && (
        <div className="center-panel">
          <div className="error-card">
            <div className="error-title">Analysis failed</div>
            <p>{error}</p>
            <button className="btn" onClick={() => setStatus("idle")}>
              Try again
            </button>
          </div>
        </div>
      )}

      {status === "done" && summary && (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab ${activeTab === t.id ? "active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
                {t.id === "rca" && summary.rca.length > 0 && (
                  <span className="badge badge-critical">{summary.rca.length}</span>
                )}
                {t.id === "iml" && (
                  <span className="badge">{summary.stats.imlCount}</span>
                )}
                {t.id === "events" && (
                  <span className="badge">{summary.stats.eventCount}</span>
                )}
                {t.id === "tips" && summary.advisories.length > 0 && (
                  <span className="badge badge-critical">{summary.advisories.length}</span>
                )}
              </button>
            ))}
          </nav>

          <main className="content">
            {activeTab === "firmware" && <FirmwareTab model={summary} />}
            {activeTab === "hardware" && <HardwareTab model={summary} />}
            {activeTab === "iml" && <ImlTab client={client} />}
            {activeTab === "events" && <EventsTab client={client} />}
            {activeTab === "rca" && <RcaTab model={summary} />}
            {activeTab === "tips" && <TipsTab model={summary} />}
          </main>
        </>
      )}
    </div>
  );
}
