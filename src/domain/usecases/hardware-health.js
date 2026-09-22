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

  // Subsystem-level fallback: some critical events name a subsystem without a
  // unit reference that matches the inventory (iLO slot numbering differs from
  // the IML numbering, e.g. the IML says "Power Supply 1" while the inventory
  // catalogues "Power Supply 8"). When no unit of that type got flagged,
  // attribute the subsystem's critical alarms to every unit so the fault is
  // surfaced in the Hardware tab / chassis instead of silently hidden.
  /** @param {string} type @param {RegExp} re */
  const subsystemFallback = (type, re) => {
    const units = hardware.filter((h) => h.type === type);
    if (units.length === 0) return;
    if (units.some((h) => h.status === "failed" || h.status === "warning")) return;
    const hits = signals.filter(
      (e) => e.severity === "critical" && re.test(e.alarm || e.message)
    );
    if (hits.length === 0) return;
    const issues = collectIssues(hits, () => true);
    for (const u of units) {
      u.status = "failed";
      if (issues.length > 0) u.issues = issues;
    }
  };
  subsystemFallback("power-supply", /\bpower suppl(y|ies)\b|\binput power\b/i);
  subsystemFallback("fan", /\bfans?\b/i);
  subsystemFallback("memory", /\bmemory\b|\bdimm\b/i);

  // System board: reuse the board entry the bcert already catalogued (TPM /
  // product-identity commodity) instead of pushing a duplicate, then derive
  // its health from board-level faults (EFUSE/CPLD/system-board/mezzanine) —
  // e.g. "Server Critical Fault (Power On Fault, System Board, AUX/MAIN EFUSE)".
  const boardPred = (/** @type {import("../entities/model.js").ImlEntry} */ e) =>
    /\bsystem board\b|\befuse\b|\bcpld\b|\bmezzanine\b/i.test(e.alarm || e.message);
  let board = hardware.find((h) => h.type === "system-board");
  if (!board && meta.productName) {
    board = { type: "system-board", source: "bcert.pkg (ProductIdentification)" };
    hardware.push(board);
  }
  if (board) {
    // merge + drop duplicate board entries (bcert commodity + old synthetic)
    for (let i = hardware.length - 1; i >= 0; i--) {
      const dup = /** @type {Record<string, unknown>} */ (hardware[i]);
      if (dup === /** @type {unknown} */ (board) || dup.type !== "system-board") continue;
      for (const [k, v] of Object.entries(dup)) {
        if (v !== undefined && (/** @type {Record<string, unknown>} */ (board))[k] === undefined) {
          (/** @type {Record<string, unknown>} */ (board))[k] = v;
        }
      }
      hardware.splice(i, 1);
    }
    // A bcert "TPM" commodity entry models itself as the system board: prefer
    // the real product name for the board identity.
    if (meta.productName && /tpm/i.test(String(board.model ?? ""))) {
      board.model = /** @type {string} */ (meta.productName);
    }
    const fill = (/** @type {string} */ k, /** @type {unknown} */ v) => {
      if (v !== undefined && (/** @type {Record<string, unknown>} */ (board))[k] === undefined) {
        (/** @type {Record<string, unknown>} */ (board))[k] = v;
      }
    };
    const rom = firmware.find((f) => /(^System ROM|^BIOS \(System ROM\))/.test(f.component));
    const ilo = firmware.find((f) => /iLO \(Lights-Out Management\)/.test(f.component));
    const bmc = firmware.find((f) => f.component === "BMC");
    const cpld = firmware.find((f) => f.component === "System CPLD");
    fill("manufacturer", meta.manufacturer);
    fill("model", meta.productName);
    fill("serialNumber", meta.serialNumber);
    fill("partNumber", meta.productId);
    fill("orderNumber", meta.orderNumber);
    fill("buildOfMaterials", meta.buildOfMaterials);
    fill("universalUniqueId", meta.universalUniqueId);
    fill("assetTag", meta.assetTag);
    fill("skuNumber", meta.skuNumber);
    fill("totalSystemMemory", meta.totalSystemMemory);
    fill("systemRomVersion", rom?.version);
    fill("iloVersion", ilo?.version);
    fill("bmcVersion", bmc?.version);
    fill("cpldVersion", cpld?.version);
    const { status, issues } = applyPred(boardPred);
    board.status = status;
    if (issues.length > 0) board.issues = issues;
  }
}

/**
 * @param {string|null|undefined} s
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
