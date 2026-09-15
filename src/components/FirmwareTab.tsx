import { Fragment, useMemo } from "react";
import type { FirmwareEntry, Summary } from "../types";

export function FirmwareTab({ model }: { model: Summary }) {
  const grouped = useMemo(() => {
    const g = new Map<string, FirmwareEntry[]>();
    for (const f of model.firmware) {
      if (!g.has(f.category)) g.set(f.category, []);
      g.get(f.category)!.push(f);
    }
    return [...g.entries()];
  }, [model.firmware]);

  if (model.firmware.length === 0) {
    return (
      <div className="panel">
        <div className="empty">No firmware information extracted.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Firmware versions</h3>
        <span className="muted">{model.firmware.length} entries</span>
      </div>
      <table className="table fw-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Version</th>
            <th>Build date</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(([category, items]) => (
            <Fragment key={category}>
              <tr className="fw-category-row">
                <td colSpan={3} className="fw-category">{category}</td>
              </tr>
              {items.map((f, i) => (
                <tr key={`${category}-${i}`}>
                  <td className="fw-component">
                    <span title={f.description}>{f.component}</span>
                    {f.description && (
                      <div className="fw-desc" title={f.description}>
                        {f.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <code
                      className={f.format === "hex" ? "fw-hex" : ""}
                      title={f.formatNote}
                    >
                      {f.version}
                    </code>
                    {f.format === "hex" && (
                      <span className="fw-hex-badge" title="Hexadecimal value, not decimal">
                        hex
                      </span>
                    )}
                  </td>
                  <td className="muted">{f.date ?? "—"}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}