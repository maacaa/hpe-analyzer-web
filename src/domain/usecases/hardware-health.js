// @ts-check
// Hardware health use case: derive a status per component by cross-referencing
// the IML error log, keep the exact IML alarms that caused the status, and
// append the system board (product identity + board firmware versions + total
// memory) as a synthetic component.
//
// Each hardware entry carries `issues` — the deduplicated alarms (newest
// first, capped) that generated its warning/failed status, so the Hardware
// tab can show the precise error message next to the component.

const MAX_ISSUES = 5;

/**
 * Compute the worst health status a component gets from matching signals.
 * @param {import("../entities/model.js").ImlEntry[]} signals
 * @param {(e: import("../entities/model.js").ImlEntry) => boolean} pred
 * @returns {"healthy"|"warning"|"failed"}
 */
function worstStatus(signals, pred) {
  /** @type {"healthy"|"warning"|"failed"} */
  let status = "healthy";
  for (const e of signals) {
    if (status === "failed") break;
    if (!pred(e)) continue;
    status = e.severity === "critical" ? "failed" : "warning";
  }
  return status;
}

/**
 * Collect the (deduplicated, capped) IML alarms affecting a component: the
 * exact errors shown on the Hardware tab, newest first.
 * @param {import("../entities/model.js").ImlEntry[]} signals
 * @param {(e: import("../entities/model.js").ImlEntry) => boolean} pred
 * @returns {Array<{date: string, severity: import("../entities/model.js").Severity, message: string}>}
 */
function collectIssues(signals, pred) {
  /** @type {Array<{date: string, severity: import("../entities/model.js").Severity, message: string}>} */
  const issues = [];
  const seen = new Set();
  for (const e of signals) {
    if (!pred(e)) continue;
    const message = e.alarm || e.message;
    if (seen.has(message)) continue;
    seen.add(message);
    issues.push({ date: e.date, severity: e.severity, message });
    if (issues.length >= MAX_ISSUES) break;
  }
  return issues;
}

/**
 * @param {import("../entities/model.js").HardwareEntry[]} hardware
 * @param {import("../entities/model.js").ImlEntry[]} iml
 * @param {Record<string, unknown>} meta
 * @param {import("../entities/model.js").FirmwareEntry[]} [firmware] normalized firmware entries
 */
export function enrichHardware(hardware, iml, meta, firmware = []) {
  const signals = iml.filter((e) => e.severity !== "information");
  /** @param {import("../entities/model.js").ImlEntry} e @param {RegExp} re */
  const has = (e, re) => re.test(e.message);
  /** @param {(e: import("../entities/model.js").ImlEntry) => boolean} pred */
  const applyPred = (pred) => {
    const status = worstStatus(signals, pred);
    const issues = collectIssues(signals, pred);
    return { status, issues };
  };

  for (const h of hardware) {
    if (h.type === "system-board") continue;
    const id = /^\d+$/.test(String(h.id ?? "")) ? String(h.id) : null;
    const slot = h.slot;
    const serial = h.serialNumber;
    /** @type {((e: import("../entities/model.js").ImlEntry) => boolean) | null} */
    let pred = null;
    /** @param {import("../entities/model.js").ImlEntry} e */
    const inSlot = (e) => has(e, new RegExp(`\\b${escapeRegExp(slot)}\\b`, "i"));
    /** @param {import("../entities/model.js").ImlEntry} e @param {string} token */
    const inId = (e, token) => has(e, new RegExp(`\\b${token} ${id}\\b`, "i"));

    switch (h.type) {
      case "cpu":
        if (id) pred = (e) => inId(e, "Processor");
        break;
      case "memory":
        if (id) pred = (e) => inId(e, "DIMM");
        break;
      case "power-supply":
      case "fan":
        if (slot) pred = inSlot;
        break;
      case "hard-drive":
        if (serial)
          pred = (e) => has(e, new RegExp(`\\b${escapeRegExp(serial)}\\b`, "i"));
        break;
      case "network-controller":
        // Intentional exception (user requirement): NICs log "link down"
        // on every restart, so we do NOT derive a health status or attach
        // IML alarms to network adapters — the Hardware tab renders them
        // without an error section.
        pred = null;
        break;
      case "storage-controller":
        if (slot)
          pred = (e) =>
            /(storage|array|controller|drive|volume|raid|write.?cache|smart)/i.test(
              e.message
            ) && inSlot(e);
        break;
      default:
        if (slot) pred = inSlot;
    }
    if (pred) {
      const { status, issues } = applyPred(pred);
      h.status = status;
      if (issues.length > 0) h.issues = issues;
    }
  }

  // Synthetic "System board" entry from the factory product identity plus the
  // board-level firmware versions and total system memory.
  if (meta.productName) {
    const rom = firmware.find((f) => /^System ROM/.test(f.component));
    const ilo = firmware.find((f) => /iLO \(Lights-Out Management\)/.test(f.component));
    const bmc = firmware.find((f) => f.component === "BMC");
    const cpld = firmware.find((f) => f.component === "System CPLD");
    hardware.push({
      type: "system-board",
      manufacturer: /** @type {string|undefined} */ (meta.manufacturer),
      model: /** @type {string} */ (meta.productName),
      serialNumber: /** @type {string|undefined} */ (meta.serialNumber),
      partNumber: /** @type {string|undefined} */ (meta.productId),
      orderNumber: /** @type {string|undefined} */ (meta.orderNumber),
      buildOfMaterials: /** @type {string|undefined} */ (meta.buildOfMaterials),
      universalUniqueId: /** @type {string|undefined} */ (meta.universalUniqueId),
      assetTag: /** @type {string|undefined} */ (meta.assetTag),
      skuNumber: /** @type {string|undefined} */ (meta.skuNumber),
      totalSystemMemory: /** @type {string|undefined} */ (meta.totalSystemMemory),
      systemRomVersion: rom?.version,
      iloVersion: ilo?.version,
      bmcVersion: bmc?.version,
      cpldVersion: cpld?.version,
      source: "bcert.pkg (ProductIdentification)",
    });
  }
}

/**
 * @param {string|null|undefined} s
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
