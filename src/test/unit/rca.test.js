import { describe, it, expect } from "vitest";
import {
  normalizeCriticalAlarm,
  extractComponent,
  buildRca,
} from "../../domain/usecases/iml-rca.js";
import { buildPlaybook } from "../../domain/services/critical-playbook.js";

describe("normalizeCriticalAlarm", () => {
  it("extracts a stable title from a component-specific message", () => {
    const a = normalizeCriticalAlarm(
      "Uncorrectable Machine Check Exception (Processor 2, APIC ID 0x00000056, Bank 0x0)"
    );
    expect(a.title).toBe("Uncorrectable Machine Check Exception");
    expect(a.component).toBe("Processor 2");
  });

  it("extracts title and DIMM component for memory errors", () => {
    const a = normalizeCriticalAlarm(
      "Uncorrectable Memory Error Threshold Exceeded (Processor 1, DIMM 10).  The DIMM is mapped out"
    );
    expect(a.title).toBe("Uncorrectable Memory Error Threshold Exceeded");
    expect(a.component).toBe("Processor 1 · DIMM 10");
  });

  it("extracts Processor component when not in parentheses (BIST)", () => {
    const a = normalizeCriticalAlarm(
      "Processor Built-In Self-Test (BIST) Failure.  Processor 0, Error Code : 0xFFFFFFFF"
    );
    expect(a.title).toBe("Processor Built-In Self-Test (BIST) Failure");
    expect(a.component).toBe("Processor 0");
  });
});

describe("extractComponent", () => {
  it("returns empty for messages without a hardware component", () => {
    expect(
      extractComponent("Uncorrectable Error Detected on the Previous Boot. Error info logged.")
    ).toBe("");
  });

  it("ignores APIC/Bank/Segment details", () => {
    expect(
      extractComponent("X (Processor 2, APIC ID 0x40, Bank 0x1)")
    ).toBe("Processor 2");
  });
});

describe("buildPlaybook", () => {
  it("always returns a meaning and ordered steps", () => {
    for (const cat of [
      "pcie",
      "memory",
      "processor",
      "cooling",
      "power",
      "storage",
      "network",
      "security",
      "ilo",
      "firmware",
      "system",
      null,
    ]) {
      const pb = buildPlaybook("Some message", "Some title", cat);
      expect(pb.meaning.length).toBeGreaterThan(40);
      expect(pb.steps.length).toBeGreaterThan(2);
      expect(pb.steps.some((s) => s.length > 10)).toBe(true);
    }
  });

  it("decodes PCIe bus/device/function and error status bits", () => {
    const pb = buildPlaybook(
      "Uncorrectable PCI Express Error Detected. PCIe Errors (Segment 0x0, Bus 0x61, Device 0x0, Function 0x0). Uncorrectable Error Status: 0x150000",
      "Uncorrectable PCI Express Error Detected",
      "pcie"
    );
    const bus = pb.details?.find((d) => d.label.includes("endpoint"));
    expect(bus?.value).toContain("0x61");
    const status = pb.details?.find((d) => d.label.includes("Status"));
    expect(status?.value).toContain("Completion Timeout");
    expect(status?.value).toContain("0x150000");
  });

  it("flags reported DIMMs in memory events", () => {
    const pb = buildPlaybook(
      "Uncorrectable Memory Error Threshold Exceeded (Processor 1, DIMM 10)",
      "Uncorrectable Memory Error Threshold Exceeded",
      "memory"
    );
    expect(pb.details?.[0].value).toContain("DIMM 10");
  });
});

describe("firmware guidance vs software tips", () => {
  const stubKb = {
    resolveRcaError: () => ({
      title: "Uncorrectable PCI Express Error Detected",
      cause:
        "There are two possible causes:\n\nFirmware is out-of-date.\nDevice is failing.",
      resolution:
        "Update the firmware to the latest version:\n\n1. Go to https://support.hpe.com/hpesc/public/home.\n2. Under **Documentation and Software**, click **Knowledge Base**.\n3. Enter System ROM 2.20 in the search bar, and then click search.\n4. Click **Drivers and Software**.\n5. Select the appropriate patch, and then click **Download**.",
      category: "pcie",
      platforms: [],
      url: null,
    }),
    matchAdvisories: () => [],
  };

  const imlEntry = {
    severity: "critical",
    classCode: 0x0008,
    eventCode: 0x0002,
    alarm: "Uncorrectable PCI Express Error Detected. PCIe Errors (Bus 0x61, Device 0x0, Function 0x0).",
    message: "",
    resolution: null,
    date: "01/01/2024",
    timestamp: 1,
  };

  it("strips firmware claims and generates a versioned software tip when no tips exist", () => {
    const firmware = [{ component: "System ROM", version: "2.80" }];
    const kbNoTips = {
      ...stubKb,
      // "System ROM 2.20" in the resolution becomes the documented fix version
    };
    const { rca } = buildRca([imlEntry], firmware, null, kbNoTips);
    expect(rca[0].cause).toMatch(/System ROM.*2\.80/);
    expect(rca[0].cause).not.toMatch(/out-of-date/i);
    expect(rca[0].resolution).toMatch(/Firmware is up to date/);
    expect(rca[0].resolution).not.toMatch(/System ROM 2\.20/);
  });

  it("marks the component as behind when the installed version is older than the fix", () => {
    const firmware = [
      { component: "BIOS (System ROM)", version: "2.10" },
      { component: "Redundant System ROM", version: "2.10" },
    ];
    const { rca } = buildRca([imlEntry], firmware, null, stubKb);
    expect(rca[0].cause).toMatch(/Firmware is not the latest version/);
    expect(rca[0].cause).toMatch(/at version 2\.10/);
    expect(rca[0].resolution).toMatch(/update its firmware|update to|update the firmware/i);
  });

  it("does not invent versions when the AHS has no record of the component", () => {
    const { rca } = buildRca([imlEntry], [], null, stubKb);
    // No firmware records -> drop the unverified firmware claim, no fabricated guidance
    expect(rca[0].resolution).not.toMatch(/System ROM 2\.20/);
    expect(rca[0].cause).toMatch(/Device is failing/);
    expect(rca[0].cause).toMatch(/does not report the implicated component/);
  });

  it("does not add tips when the firmware already covers the fix", () => {
    const firmware = [{ component: "BIOS (System ROM)", version: "2.80" }];
    const { softwareTips } = buildRca([imlEntry], firmware, null, stubKb);
    expect(softwareTips.length).toBe(0);
  });

  it("keeps HPE cause/resolution when a software tip applies", () => {
    const kbWithTips = {
      ...stubKb,
      matchAdvisories: () => [
        {
          id: "adv-1",
          component: "System ROM",
          fixedIn: "2.20",
          results: [{ component: "System ROM", version: "2.80", affected: true, label: "", fix: "" }],
        },
      ],
    };
    const { rca } = buildRca([imlEntry], [], null, kbWithTips);
    expect(rca[0].cause).toMatch(/Firmware is out-of-date/i);
    expect(rca[0].resolution).not.toBeNull();
  });
});
