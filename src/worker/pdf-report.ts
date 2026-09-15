// PDF report generator (rendered inside the worker, which owns the model).
//
// A4, paginated, with a translucent diagonal "MediaKind/Harmonic" watermark
// on every page, per-page header/footer and a status/severity color palette.
// jsPDF + jspdf-autotable load through dynamic import so the PDF code (and
// its dependency weight) only downloads when the user exports a report.

import type { Summary } from "../types";

const WATERMARK = "MediaKind/Harmonic";

const M = 40; // page margin (pt)
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const TOP = 64; // content top below the page header band
const HEADER_H = 36;

const TEAL: RGB = [23, 163, 152];
const DARK: RGB = [16, 24, 38];
const DARK2: RGB = [31, 41, 58];
const MUTED: RGB = [138, 145, 165];
const BODY: RGB = [40, 46, 60];
const OK: RGB = [38, 160, 128];
const WARN: RGB = [214, 138, 10];
const CRIT: RGB = [226, 61, 92];
const ROW_ALT: RGB = [248, 249, 252];
const BORDER: RGB = [222, 226, 236];

type RGB = [number, number, number];

type Doc = import("jspdf").jsPDF & {
  GState: new (o: { opacity: number }) => unknown;
};

interface CellData {
  cell: {
    colSpan: number;
    text: string[];
    styles: { fillColor?: unknown; textColor?: unknown; fontStyle?: string };
  };
  row: { raw: unknown };
}

function sevColor(sev: string): RGB {
  return sev === "critical" ? CRIT : sev === "warning" ? WARN : MUTED;
}

function statusColor(status: string | undefined | null): RGB {
  return status === "failed" ? CRIT : status === "warning" ? WARN : OK;
}

function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

const HW_LABEL: Record<string, string> = {
  cpu: "Processor",
  memory: "Memory (DIMM)",
  "storage-controller": "Storage controller",
  "hard-drive": "Hard drive",
  "network-controller": "Network adapter",
  "video-controller": "Video controller",
  fan: "Fan",
  "power-supply": "Power supply",
  "system-board": "System board",
};

const HW_FIELDS: [string, string][] = [
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
];

export interface PdfResult {
  pdf: Uint8Array;
  pages: number;
}

export async function buildPdfReport(
  s: Summary,
  fileName: string
): Promise<PdfResult> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true }) as Doc;
  let y = TOP;

  const meta = (s.meta ?? {}) as Record<string, unknown>;

  const ensure = (needed: number) => {
    if (y + needed > PAGE_H - M) {
      doc.addPage();
      y = TOP + 8;
    }
  };

  const sectionTitle = (label: string) => {
    ensure(50);
    doc.setFillColor(...DARK);
    doc.rect(M - 6, y - 4, PAGE_W - 2 * M + 12, 22, "F");
    doc.setFillColor(...TEAL);
    doc.rect(M - 6, y - 4, 4, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(label, M + 6, y + 11);
    y += 36;
  };

  const paragraph = (text: string, color: RGB = BODY, bold = false, size = 9.5) => {
    if (!text) return;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, PAGE_W - 2 * M - 4) as string[];
    for (const line of lines) {
      ensure(size + 5);
      doc.text(line, M + 2, y);
      y += size + 5;
    }
  };

  const kvTable = (rows: [string, string][], labelW = 150) => {
    const body = rows.filter(([, v]) => v !== "").map(([k, v]) => [k, esc(v) || "—"]);
    if (!body.length) return;
    ensure(60);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 4,
        textColor: BODY,
        lineColor: BORDER,
        lineWidth: 0.5,
      },
      columnStyles: {
        0: { cellWidth: labelW, fontStyle: "bold", textColor: MUTED, fillColor: ROW_ALT },
      },
      body,
    });
    y = tableEnd(doc, y) + 12;
  };

  // ---------- 1. Server information ----------
  sectionTitle("Server information");
  const info: [string, string][] = [
    ["Product", esc(meta.productName)],
    ["Serial number", esc(meta.serialNumber)],
    ["Product ID", esc(meta.productId)],
    ["Order number", esc(meta.orderNumber)],
    ["Manufacturer", esc(meta.manufacturer)],
    ["SKU", esc(meta.skuNumber)],
    ["Asset tag", esc(meta.assetTag)],
    ["UUID", esc(meta.universalUniqueId)],
    ["Build of materials", esc(meta.buildOfMaterials)],
    ["Total system memory", esc(meta.totalSystemMemory)],
    ["Source file", esc(meta.sourceFile)],
  ];
  if (s.customerInfo) {
    info.push(
      ["Case number", esc(s.customerInfo.caseNumber)],
      ["Contact", esc(s.customerInfo.contactName)],
      ["Phone", esc(s.customerInfo.phoneNumber)],
      ["Email", esc(s.customerInfo.email)],
      ["Company", esc(s.customerInfo.companyName)]
    );
  }
  kvTable(info);

  // ---------- 2. Analysis overview ----------
  sectionTitle("Analysis overview");
  kvTable(
    [
      ["IML entries", String(s.stats.imlCount)],
      ["iLO Event entries", String(s.stats.eventCount)],
      ["Critical events", String(s.stats.criticalCount)],
      ["Warning events", String(s.stats.warningCount)],
      ["RCA groups", String(s.rca.length)],
      ["Firmware entries", String(s.firmware.length)],
      ["Hardware components", String(s.hardware.length)],
      ["Advisories shown", String(s.advisories.length)],
    ],
    190
  );

  // ---------- 3. Firmware ----------
  sectionTitle(`Firmware versions (${s.firmware.length})`);
  const fwRows: Array<string[] | { category: string }> = [];
  const fwGroups = groupBy(s.firmware, (f) => f.category || "Other");
  for (const [category, items] of fwGroups.entries()) {
    fwRows.push({ category });
    for (const f of items) {
      fwRows.push([
        f.component + (f.description ? ` — ${f.description}` : ""),
        f.version + (f.format === "hex" ? "  (hex)" : ""),
        f.date ?? "—",
      ]);
    }
  }
  if (fwRows.length === 0) {
    paragraph("No firmware information extracted.", MUTED);
  } else {
    ensure(60);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 4,
        textColor: BODY,
        lineColor: BORDER,
        lineWidth: 0.5,
      },
      columnStyles: { 0: { cellWidth: 250 }, 1: { cellWidth: 150 }, 2: { cellWidth: 79 } },
      didParseCell: (data: CellData) => {
        const raw = data.row.raw;
        if (typeof raw === "object" && raw !== null && "category" in raw) {
          data.cell.colSpan = 3;
          data.cell.text = [`▪ ${(raw as { category: string }).category}`];
          data.cell.styles.fillColor = DARK2;
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
        }
      },
      body: fwRows as unknown as string[][],
    });
    y = tableEnd(doc, y) + 12;
  }

  // ---------- 4. Hardware ----------
  sectionTitle(`Hardware components (${s.hardware.length})`);
  for (const h of s.hardware) {
    const label = hwTitle(h);
    ensure(130);
    doc.setFillColor(...ROW_ALT);
    doc.rect(M - 2, y - 12, PAGE_W - 2 * M + 4, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BODY);
    doc.text(label, M + 2, y + 2);
    if (h.status) {
      doc.setTextColor(...statusColor(h.status));
      doc.setFontSize(8.5);
      doc.text(`  ${h.status.toUpperCase()}`, M + 2 + doc.getTextWidth(label) + 10, y + 2);
    }
    y += 22;

    for (const issue of h.issues ?? []) {
      const color = sevColor(issue.severity);
      doc.setFillColor(...color);
      doc.rect(M + 2, y - 7, 5, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...color);
      doc.text(issue.severity.toUpperCase(), M + 14, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(issue.date, M + 14 + 62, y, { baseline: "alphabetic" });
      doc.setFontSize(8.5);
      doc.setTextColor(...BODY);
      const lines = doc.splitTextToSize(issue.message, PAGE_W - 2 * M - 150) as string[];
      ensure(lines.length * 11);
      let iy = y;
      for (const line of lines) {
        doc.text(line, M + 14 + 88, iy);
        iy += 11;
      }
      y = Math.max(iy, y) + 3;
    }

    const rows: [string, string][] = [];
    const rec = h as unknown as Record<string, unknown>;
    for (const [k, lbl] of HW_FIELDS) {
      const v = esc(rec[k]);
      if (v && v !== "NA") rows.push([lbl, v]);
    }
    if (rows.length) kvTable(rows, 140);
    y += 8;
  }

  // ---------- 5. RCA ----------
  sectionTitle(`Root cause analysis (${s.rca.length})`);
  if (s.rca.length === 0) {
    paragraph("No critical events detected. This unit looks healthy.", MUTED);
  } else {
    for (const r of s.rca) {
      ensure(170);
      const color = sevColor(r.severity);
      const rpt =
        r.count >= 2
          ? `Repeated ${r.count} times · most recent ${r.lastDate}`
          : `Occurred ${r.lastDate}`;
      paragraph(
        rpt + (r.components.length ? ` · Affected: ${r.components.join(", ")}` : ""),
        MUTED,
        false,
        8.5
      );
      paragraph(r.title, color, true, 10.5);
      if (r.cause) paragraph(`Cause (HPE): ${r.cause}`, BODY, false, 9);
      if (r.resolution) paragraph(`Resolution (HPE): ${r.resolution}`, BODY, false, 9);
      if (r.docUrl) {
        ensure(14);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...TEAL);
        doc.textWithLink("Official HPE documentation", M + 2, y, { url: r.docUrl });
        y += 14;
      }
      for (const bug of r.bugs) {
        ensure(60);
        doc.setFillColor(255, 246, 238);
        doc.rect(M, y - 12, PAGE_W - 2 * M, 20, "F");
        paragraph(`Known firmware issue (HPE advisory): ${bug.title}`, WARN, true, 9);
        if (bug.description) paragraph(bug.description, BODY, false, 8.5);
        for (const res of bug.results) {
          ensure(22);
          doc.setFontSize(9);
          doc.setFont("helvetica", "bold");
          if (res.affected) {
            doc.setTextColor(...CRIT);
            doc.text("AFFECTED", M + 6, y);
          } else {
            doc.setTextColor(...OK);
            doc.text("OK", M + 6, y);
          }
          doc.setFont("helvetica", "normal");
          doc.setTextColor(...BODY);
          paragraph(`  ${res.label}${res.fix ? ` ${res.fix}` : ""}`, BODY, false, 9);
        }
      }
      y += 10;
    }
  }

  // ---------- 6. Tips ----------
  sectionTitle(`Known firmware advisories shown (${s.advisories.length})`);
  if (s.advisories.length === 0) {
    paragraph(
      "No affected firmware advisories for this server: every installed version either includes the fix or the advisory does not apply to its components.",
      MUTED
    );
  } else {
    for (const a of s.advisories) {
      ensure(60);
      const color = sevColor(a.severity);
      paragraph(a.title, color, true, 10.5);
      if (a.description) paragraph(a.description, BODY, false, 9);
      for (const res of a.results) {
        ensure(24);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...CRIT);
        doc.text("AFFECTED", M + 6, y);
        doc.setFont("helvetica", "normal");
        paragraph(
          `  ${res.component ?? ""}${res.version ? `  ${res.version}` : ""}`,
          BODY,
          false,
          9
        );
        if (res.fix) paragraph(`   ${res.fix}`, MUTED, false, 8.5);
      }
      y += 8;
    }
  }

  // ---------- headers, footers, watermark on every page ----------
  const pages = doc.getNumberOfPages();
  const now = new Date().toLocaleString();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(...DARK);
    doc.rect(0, 0, PAGE_W, HEADER_H, "F");
    doc.setFillColor(...TEAL);
    doc.rect(0, HEADER_H, PAGE_W, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text("HPE AHS Analyzer — Analysis Report", M, 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(160, 168, 185);
    doc.text(`${fileName} · ${now}`, PAGE_W - M, 22, { align: "right" });
    doc.setFontSize(7.5);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 16, { align: "right" });
    doc.setTextColor(...MUTED);
    doc.text("HPE Active Health System log analysis", M, PAGE_H - 16);

    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.12 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(44);
    doc.setTextColor(110, 118, 135);
    doc.text(WATERMARK, PAGE_W / 2, PAGE_H / 2, {
      angle: 32,
      align: "center",
      baseline: "middle",
    });
    doc.restoreGraphicsState();
  }

  const pdf = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
  return { pdf, pages };
}

function hwTitle(h: { type: string; model?: string; slot?: string; id?: string }): string {
  if (h.model) return h.model;
  if (h.slot) return h.slot;
  if (h.id !== undefined) return `${HW_LABEL[h.type] ?? h.type} ${h.id}`;
  return HW_LABEL[h.type] ?? "System board";
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const g = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(it);
  }
  return g;
}

/** lastAutoTable.finalY that survives API variations. */
function tableEnd(doc: Doc, fallback: number): number {
  const t = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return t?.finalY ?? fallback;
}
