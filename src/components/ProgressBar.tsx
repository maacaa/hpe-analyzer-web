import { useEffect, useMemo, useRef, useState } from "react";
import type { ProgressInfo } from "../types";

export function ProgressBar({ progress }: { progress: ProgressInfo | null }) {
  const pct = progress?.pct ?? 0;
  const startRef = useRef(performance.now());
  const [etaSec, setEtaSec] = useState<number | null>(null);

  // Coarse ETA estimate based on elapsed time and fraction done.
  useEffect(() => {
    if (!progress || pct <= 0 || pct >= 100) {
      setEtaSec(null);
      return;
    }
    const elapsed = (performance.now() - startRef.current) / 1000;
    const remaining = (elapsed / pct) * (100 - pct);
    setEtaSec(remaining);
  }, [pct, progress]);

  const etaText = useMemo(() => {
    if (etaSec === null) return "";
    if (etaSec < 60) return `~${Math.max(1, Math.round(etaSec))}s remaining`;
    if (etaSec < 3600) return `~${Math.round(etaSec / 60)} min remaining`;
    return `~${(etaSec / 3600).toFixed(1)}h remaining`;
  }, [etaSec]);

  return (
    <div className="center-panel">
      <div className="progress-card">
        <div className="progress-row">
          <span className="progress-phase">
            {progress?.phase ?? "Loading…"}
          </span>
          <span className="progress-pct">{pct.toFixed(1)}%</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <div className="progress-meta">
          <span>{etaText}</span>
          <span className="muted">
            {progress
              ? `${formatBytes(progress.done)} / ${formatBytes(progress.total)}`
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
