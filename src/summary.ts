import type { Model } from "./types";

/** Build a human-readable text report from an analysis model. */
export function buildSummary(m: Model): string {
  const lines: string[] = [];
  lines.push("HPE AHS Analyzer - Analysis report");
  lines.push("==================================");
  lines.push("");
  lines.push(`Source file : ${String(m.meta.sourceFile ?? "")}`);
  lines.push(`Product     : ${String(m.meta.productName ?? "-")}`);
  lines.push(`Serial      : ${String(m.meta.serialNumber ?? "-")}`);
  lines.push(`Product ID  : ${String(m.meta.productId ?? "-")}`);
  lines.push(`Order       : ${String(m.meta.orderNumber ?? "-")}`);
  lines.push("");
  lines.push("Stats:");
  lines.push(`  IML entries   : ${m.stats.imlCount}`);
  lines.push(`  Event entries : ${m.stats.eventCount}`);
  lines.push(`  Critical      : ${m.stats.criticalCount}`);
  lines.push(`  Warning       : ${m.stats.warningCount}`);
  lines.push(`  RCA groups    : ${m.rca.length}`);
  lines.push("");
  lines.push("Firmware:");
  for (const f of m.firmware) {
    lines.push(`  ${f.component} = ${f.version}${f.date ? ` (${f.date})` : ""}`);
  }
  lines.push("");
  lines.push("Hardware (with health):");
  for (const h of m.hardware) {
    const name = [h.type, h.slot, h.model].filter(Boolean).join(" ");
    lines.push(`  ${name} [${h.status ?? "healthy"}]`);
  }
  lines.push("");
  lines.push("RCA:");
  for (const r of m.rca) {
    lines.push(`  [${r.severity}] ${r.title} (x${r.count}) - last ${r.lastDate}`);
    lines.push(`    components: ${r.components.join(", ") || "-"}`);
    if (r.resolution) lines.push(`    resolution: ${r.resolution}`);
  }
  lines.push("");
  lines.push("Advisories:");
  for (const a of m.advisories) {
    lines.push(`  [${a.severity}] ${a.title}`);
    for (const res of a.results) lines.push(`    ${res.label}`);
  }
  return lines.join("\n");
}