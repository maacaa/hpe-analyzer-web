import { useMemo } from "react";
import type { HardwareEntry, Summary } from "../types";
import { SevBadge } from "./ImlTab";

const TYPE_LABEL: Record<string, string> = {
  cpu: "Processor",
  memory: "Memory (DIMM)",
  "storage-controller": "Storage controller",
  "hard-drive": "Hard drive",
  "network-controller": "Network adapter",
  "video-controller": "Video controller",
  fan: "Fan",
  "power-supply": "Power supply",
  "pci-device": "PCI card",
  "system-board": "System board",
};

const STATUS_LABEL = { healthy: "OK", warning: "Warning", failed: "Failed" } as const;

// Order + labels of the fields shown per component. `model` is omitted because
// it is already used as the card title.
const FIELD_ORDER: [keyof HardwareEntry, string][] = [
  ["manufacturer", "Manufacturer"],
  ["family", "Family"],
  ["speed", "Speed"],
  ["cores", "Cores"],
  ["cache", "Cache"],
  ["stepping", "Stepping"],
  ["memoryType", "Memory type"],
  ["moduleType", "Module type"],
  ["size", "Size"],
  ["slot", "Slot"],
  ["capacity", "Capacity"],
  ["serialNumber", "Serial"],
  ["partNumber", "Part number"],
  ["firmware", "Firmware"],
  ["driveType", "Drive type"],
  ["controllerType", "Controller"],
  ["connectedDrives", "Drives"],
  ["memorySize", "Memory"],
  ["interface", "Interface"],
  ["macAddress", "MAC address"],
  ["adapterType", "Adapter type"],
  ["vendorId", "PCI vendor ID"],
  ["deviceId", "PCI device ID"],
  ["subsystemVendorId", "Subsystem vendor"],
  ["subsystemDeviceId", "Subsystem device"],
  ["driverVersion", "Driver version"],
  ["correctable", "Correctable errors"],
  ["uncorrectable", "Uncorrectable errors"],
  ["present", "Present"],
  ["redundant", "Redundant"],
  ["sparePartNumber", "Spare part"],
  ["orderNumber", "Order number"],
  ["buildOfMaterials", "Build of materials"],
  ["universalUniqueId", "UUID"],
  ["assetTag", "Asset tag"],
  ["skuNumber", "SKU"],
  ["totalSystemMemory", "Total system memory"],
  ["systemRomVersion", "System ROM"],
  ["iloVersion", "iLO"],
  ["bmcVersion", "BMC"],
  ["cpldVersion", "CPLD"],
] as [keyof HardwareEntry, string][];

function title(h: HardwareEntry): string {
  if (h.model) return h.model;
  if (h.slot) return h.slot;
  if (h.id !== undefined) return `${TYPE_LABEL[h.type] ?? h.type} ${h.id}`;
  return TYPE_LABEL[h.type] ?? h.type;
}

export function HardwareTab({ model }: { model: Summary }) {
  const grouped = useMemo(() => {
    const g = new Map<string, HardwareEntry[]>();
    for (const h of model.hardware) {
      const label = TYPE_LABEL[h.type] ?? h.type;
      if (!g.has(label)) g.set(label, []);
      g.get(label)!.push(h);
    }
    return [...g.entries()];
  }, [model.hardware]);

  if (model.hardware.length === 0) {
    return (
      <div className="panel">
        <div className="empty">No hardware information extracted.</div>
      </div>
    );
  }

  const meta = model.meta;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Hardware components</h3>
        <span className="muted">{model.hardware.length} components</span>
      </div>
      <div className="server-info">
        <div className="fw-category">Server information</div>
        <dl className="info-grid">
          {[
            ["Product", meta.productName],
            ["Serial", meta.serialNumber],
            ["Product ID", meta.productId],
            ["Order", meta.orderNumber],
            ["UUID", meta.universalUniqueId],
            ["Asset tag", meta.assetTag],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={String(k)} className="info-row">
                <dt>{String(k)}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
      </div>
      {grouped.map(([label, items]) => (
        <div className="fw-group" key={label}>
          <div className="fw-category">
            {label} ({items.length})
          </div>
          <div className="cards">
            {items.map((h, i) => (
              <div className="card" key={i}>
                <div className="card-title">
                  {title(h)}
                  {h.status && (
                    <span className={`hw-status hw-status-${h.status}`}>
                      {STATUS_LABEL[h.status]}
                    </span>
                  )}
                </div>
                {h.issues && h.issues.length > 0 && (
                  <div className="hw-issues">
                    <div className="hw-issues-label">
                      Errors detected ({h.issues.length}
                      {h.issues.length === 1 ? "" : " most recent"}):
                    </div>
                    {h.issues.map((issue, j) => (
                      <div key={j} className={`hw-issue hw-issue-${issue.severity}`}>
                        <SevBadge sev={issue.severity} />
                        <span className="hw-issue-date">{issue.date}</span>
                        <span className="hw-issue-message" title={issue.message}>
                          {issue.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <dl>
                  {FIELD_ORDER.filter(([k]) => h[k] && h[k] !== "NA").map(
                    ([k, lbl]) => (
                      <div key={k} className="dl-row">
                        <dt>{lbl}</dt>
                        <dd>{String(h[k])}</dd>
                      </div>
                    )
                  )}
                </dl>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
