import { useCallback, useEffect, useState } from "react";
import type { ProgressInfo, Summary } from "./types";
import type { AnalyzerClient } from "./api/worker-client";
import { saveBinaryFile } from "./api/save";
import { DropZone } from "./components/DropZone";
import { ProgressBar } from "./components/ProgressBar";
import { FirmwareTab } from "./components/FirmwareTab";
import { HardwareView } from "./components/HardwareView";
import { ImlTab } from "./components/ImlTab";
import { EventsTab } from "./components/EventsTab";
import { RcaTab } from "./components/RcaTab";
import { TipsTab } from "./components/TipsTab";
import { ThemePicker } from "./components/ThemePicker";
import { initTheme, applyTheme, type Theme } from "./theme";
import { closeDetail, hideTip } from "./chassis-engine.js";

type Status = "idle" | "loading" | "done" | "error";

const TABS = [
  { id: "firmware", label: "Firmware", icon: "firmware" },
  { id: "hardware", label: "Hardware Health", icon: "hardware" },
  { id: "iml", label: "IML Logs", icon: "iml" },
  { id: "events", label: "Event Logs", icon: "events" },
  { id: "rca", label: "RCA", icon: "rca" },
  { id: "tips", label: "Tips", icon: "tips" },
] as const;

const TAB_ICON: Record<string, string> = {
  firmware:
    '<path d="M2 4.5 8 1.5l6 3-6 3z"/><path d="M2 8.5l6 3 6-3M2 11.5l6 3 6-3"/>',
  hardware:
    '<rect x="4" y="4" width="8" height="8" rx="1"/><path d="M6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3"/>',
  iml: '<path d="M2 3h12M2 8h12M2 13h8"/>',
  events: '<path d="M1 8h3l2-5 3 10 2-5h4"/>',
  rca: '<path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5v3.5M8 11.6v.1"/>',
  tips:
    '<path d="M6 12.5h4M6.5 15h3M8 1.5a4.5 4.5 0 0 0-2.6 8.2V11h5.2V9.7A4.5 4.5 0 0 0 8 1.5z"/>',
};
const tabIcon = (id: string) =>
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${TAB_ICON[id] ?? TAB_ICON.hardware}</svg>`;

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

function RailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2 10.5V5.5M5 12.5V3.5M8 13.5V2.5M11 12.5V3.5M14 10.5V5.5" />
    </svg>
  );
}

export function App({ client }: { client: AnalyzerClient }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("firmware");
  const [fileName, setFileName] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [theme, setTheme] = useState<Theme>(() => initTheme());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setRecent(getRecentFiles());
  }, []);

  const runAnalysis = useCallback(
    async (file: File) => {
      setStatus("loading");
      setError(null);
      setUploadOpen(false);
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

  const onFile = useCallback((file: File) => {
    setFileName(file.name);
    void runAnalysis(file);
  }, [runAnalysis]);

  const onBrowse = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ahs";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        setUploadOpen(false);
        onFile(file);
      }
    };
    input.click();
  }, [onFile]);

  const cancelAnalysis = useCallback(() => {
    // Terminating the worker releases all analysis memory (RNF-11); the
    // pending analyze() promise rejects and the UI returns to idle.
    client.cancel();
    setStatus("idle");
    setProgress(null);
  }, [client]);

  const reset = useCallback(() => {
    client.cancel(); // free the resident model memory as well
    closeDetail();
    hideTip();
    setStatus("idle");
    setActiveTab("firmware");
    setSummary(null);
    setFileName(null);
    setError(null);
    setProgress(null);
  }, [client]);

  const exportReport = useCallback(async () => {
    if (status !== "done" || exporting) return;
    setExporting(true);
    try {
      const pdf = await client.exportReport();
      await saveBinaryFile("analysis-report.pdf", "application/pdf", ".pdf", pdf);
    } catch {
      // export cancelled or failed: nothing to do for the user
    } finally {
      setExporting(false);
    }
  }, [client, status, exporting]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onBrowse();
        return;
      }
      if (e.key === "Escape") {
        if (uploadOpen) setUploadOpen(false);
        closeDetail();
        hideTip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBrowse, uploadOpen]);

  const meta = summary?.meta as
    | {
        productName?: string;
        serialNumber?: string;
        productId?: string;
        orderNumber?: string;
        manufacturer?: string;
        universalUniqueId?: string;
        totalSystemMemory?: { MemorySize?: string };
      }
    | undefined;
  const stats = summary?.stats;
  const memGB = Math.round(
    parseFloat(String(meta?.totalSystemMemory?.MemorySize ?? "0")) / 1024
  );

  const railCounts: Record<string, { n: number; tone?: string } | null> = {
    firmware: null,
    hardware: null,
    iml: stats ? { n: stats.imlCount, tone: "critical" } : null,
    events: stats ? { n: stats.eventCount } : null,
    rca: summary ? { n: summary.rca.length, tone: "critical" } : null,
    tips: summary ? { n: summary.advisories.length } : null,
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><RailIcon /></span>
          <span>
            <span className="brand-name">HPE Analyzer</span>
            <span className="brand-tag">AHS Log Analysis</span>
          </span>
        </div>
        {status === "done" && meta && stats && (
          <div className="meta">
            <div className="meta-item">
              <span className="meta-k">Product</span>
              <span className="meta-v hi">{String(meta.productName ?? "")}</span>
            </div>
            <div className="meta-item">
              <span className="meta-k">Serial</span>
              <span className="meta-v">{String(meta.serialNumber ?? "")}</span>
            </div>
            <div className="meta-item">
              <span className="meta-k">Memory</span>
              <span className="meta-v">{memGB} GB</span>
            </div>
            <div className="meta-item">
              <span className="meta-k">Bundle</span>
              <span className="meta-v">{stats.records} rec · {stats.zbbFiles} ZBB</span>
            </div>
            <div className="meta-item">
              <span className="meta-k">AHS file</span>
              <span className="meta-v">{fileName}</span>
            </div>
          </div>
        )}
        <div className="topbar-actions">
          <ThemePicker
            theme={theme}
            onChange={(t) => {
              applyTheme(t);
              setTheme(t);
            }}
          />
          <button
            className="btn btn-ghost"
            onClick={() => void exportReport()}
            aria-busy={exporting}
            disabled={status !== "done" || exporting}
            title="Export the analysis report as PDF"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
            </svg>
            <span>{exporting ? "Exporting…" : "Export report"}</span>
          </button>
          <a
            className="btn btn-primary"
            href="https://support.hpe.com/connect/s/createcase?client=home"
            target="_blank"
            rel="noreferrer"
            title="Open the HPE Support Center to create a support case"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Create HPE case
          </a>
        </div>
      </header>

      <div className="shell">
        <nav className="rail" aria-label="Analyzer sections">
          <div className="rail-group">
            <div className="rail-title">Analyze</div>
            {TABS.filter((t) => status === "done" || t.id !== "hardware").map((t) => (
              <button
                key={t.id}
                className="rail-item"
                aria-current={activeTab === t.id && status !== "idle" && status !== "loading"}
                onClick={() => { setStatus((st) => (st === "done" ? "done" : st)); setActiveTab(t.id); }}
                dangerouslySetInnerHTML={{
                  __html: `${tabIcon(t.id)}<span>${t.label}</span>${
                    railCounts[t.id] ? `<span class="rail-count" ${railCounts[t.id]!.tone ? `data-tone="${railCounts[t.id]!.tone}"` : ""}>${railCounts[t.id]!.n.toLocaleString()}</span>` : ""
                  }`,
                }}
              />
            ))}
          </div>
          <div className="rail-foot">
            {fileName && (
              <>
                <div className="rail-foot-k">AHS file</div>
                <div className="rail-foot-v">{fileName}</div>
              </>
            )}
            {meta?.universalUniqueId && (
              <>
                <div className="rail-foot-k" style={{ marginTop: 6 }}>UUID</div>
                <div className="rail-foot-v">{String(meta.universalUniqueId)}</div>
              </>
            )}
            {stats && (
              <>
                <div className="rail-foot-k" style={{ marginTop: 6 }}>Bundle</div>
                <div className="rail-foot-v">{stats.records} records · {stats.zbbFiles} ZBB files</div>
              </>
            )}
            <button
              className="ahs-analyze-btn"
              onClick={() => setUploadOpen(true)}
              title="Analyze another AHS file"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4.5h4l1.3 1.5H14v7.5H2z" /><path d="M10.5 2.5v4M8.5 4.5h4" />
              </svg>
              <span>Analyze another AHS file</span>
            </button>
          </div>
        </nav>

        <main className="workspace" id="workspace">
          {status === "done" && summary && (
            <>
              {activeTab === "hardware" && <HardwareView summary={summary} />}
              {activeTab === "firmware" && <FirmwareTab model={summary} />}
              {activeTab === "iml" && (
                <ImlTab client={client} summary={summary} onNavigate={setActiveTab} />
              )}
              {activeTab === "events" && <EventsTab client={client} />}
              {activeTab === "rca" && <RcaTab model={summary} />}
              {activeTab === "tips" && <TipsTab model={summary} />}
            </>
          )}
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
            <div style={{ marginTop: 60 }}>
              <ProgressBar progress={progress} />
              <div className="center-panel" style={{ paddingTop: 16 }}>
                <button className="btn" onClick={cancelAnalysis}>Cancel</button>
              </div>
            </div>
          )}
          {status === "error" && (
            <div className="center-panel" style={{ marginTop: 60 }}>
              <div className="error-card">
                <div className="error-title">Analysis failed</div>
                <p>{error}</p>
                <button className="btn" onClick={() => setStatus("idle")}>Try again</button>
              </div>
            </div>
          )}
        </main>
      </div>

      <aside className="detail" id="detail" aria-hidden="true" aria-label="Component detail" />
      <div className="tip" id="tip" role="tooltip" />

      <div className="ahs-upload-overlay" data-open={String(uploadOpen)} aria-hidden={!uploadOpen} role="dialog" aria-modal="true">
        <section className="ahs-upload-card">
          <header className="ahs-upload-head">
            <div>
              <h2 className="ahs-upload-title" id="ahsUploadTitle">Analyze AHS file</h2>
              <p className="ahs-upload-sub">Load another server bundle to run the full analysis pipeline.</p>
            </div>
            <button className="close-x" onClick={() => setUploadOpen(false)} aria-label="Close Analyze AHS file">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
            </button>
          </header>
          <div className="ahs-upload-body">
            <div
              className="ahs-dropzone"
              data-dragover="false"
              onClick={onBrowse}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.dataset.dragover = "true"; }}
              onDragLeave={(e) => { e.currentTarget.dataset.dragover = "false"; }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.dataset.dragover = "false";
                const file = e.dataTransfer.files?.[0];
                if (file) onFile(file);
              }}
            >
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M4 14.5v4A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-4" /></svg>
              <div className="ahs-drop-title">Drop your AHS file here</div>
              <div className="ahs-drop-or">or</div>
              <button className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); onBrowse(); }}>Browse file</button>
              <div className="ahs-file-note">Supported: .ahs bundles · max 2 GB<span className="ahs-file-name">Processed locally, nothing is uploaded</span></div>
            </div>
            {recent.length > 0 && (
              <div className="recent-panel">
                <div className="recent-title">Recent analyses</div>
                {recent.map((entry) => (
                  <button
                    key={entry.fingerprint}
                    className="recent-item"
                    onClick={() => { setUploadOpen(false); openRecent(entry); }}
                    title="Reopen this analysis from the local cache"
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <footer className="ahs-upload-foot" />
        </section>
      </div>
    </>
  );
}
