// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ImlTab } from "../../components/ImlTab";
import { FirmwareTab } from "../../components/FirmwareTab";
import { HardwareTab } from "../../components/HardwareTab";
import { RcaTab } from "../../components/RcaTab";
import { TipsTab } from "../../components/TipsTab";
import { EventsTab } from "../../components/EventsTab";
import { iml, makeModel } from "../fixtures";
import type { LogRow, LogQueryResult } from "../../types";
import type { AnalyzerClient } from "../../api/worker-client";

function imlModel() {
  return makeModel({
    iml: [
      iml({ message: "Processor BIST Failure", alarm: "Processor BIST Failure", severity: "critical" }),
      iml({ message: "Temperature threshold exceeded", alarm: "Temperature threshold exceeded", severity: "warning" }),
      iml({ message: "Server reset", alarm: "Server reset", severity: "information" }),
    ],
    stats: { records: 1, zbbFiles: 1, imlCount: 3, eventCount: 0, criticalCount: 1, warningCount: 1 },
  });
}

/** A stand-in for AnalyzerClient.query that filters/paginates in-memory. */
function fakeClient(rows: LogRow[]): AnalyzerClient {
  return {
    query: async (
      _tab: "iml" | "events",
      filter: { severity: string; text: string },
      page: number
    ): Promise<LogQueryResult> => {
      const q = filter.text.trim().toLowerCase();
      const filtered = rows.filter((r) => {
        if (filter.severity !== "all" && r.severity !== filter.severity) return false;
        if (q && !r.message.toLowerCase().includes(q)) return false;
        return true;
      });
      const start = page * 500;
      return {
        rows: filtered.slice(start, start + 500),
        total: filtered.length,
      };
    },
  } as unknown as AnalyzerClient;
}

function rowsFrom(model: ReturnType<typeof imlModel>): LogRow[] {
  return model.iml.map((e) => ({
    date: e.date,
    severity: e.severity,
    message: e.message,
    alarm: e.alarm,
    classCode: e.classCode,
    eventCode: e.eventCode,
  }));
}

describe("ImlTab filtering (worker-backed)", () => {
  it("shows all entries by default", async () => {
    const model = imlModel();
    render(<ImlTab client={fakeClient(rowsFrom(model))} />);
    await screen.findByText(/BIST Failure/);
    expect(screen.getByText(/threshold exceeded/)).toBeInTheDocument();
    expect(screen.getByText(/Server reset/)).toBeInTheDocument();
  });

  it("filters to critical only", async () => {
    const model = imlModel();
    render(<ImlTab client={fakeClient(rowsFrom(model))} />);
    await screen.findByText(/BIST Failure/);
    fireEvent.click(screen.getByRole("button", { name: "Critical" }));
    await waitFor(() =>
      expect(screen.getByText(/BIST Failure/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Server reset/)).not.toBeInTheDocument();
    expect(screen.queryByText(/threshold exceeded/)).not.toBeInTheDocument();
  });

  it("filters to warning only", async () => {
    const model = imlModel();
    render(<ImlTab client={fakeClient(rowsFrom(model))} />);
    await screen.findByText(/BIST Failure/);
    fireEvent.click(screen.getByRole("button", { name: "Warning" }));
    await waitFor(() =>
      expect(screen.getByText(/threshold exceeded/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/BIST Failure/)).not.toBeInTheDocument();
  });

  it("filters to information only", async () => {
    const model = imlModel();
    render(<ImlTab client={fakeClient(rowsFrom(model))} />);
    await screen.findByText(/BIST Failure/);
    fireEvent.click(screen.getByRole("button", { name: "Information" }));
    await waitFor(() =>
      expect(screen.getByText(/Server reset/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/BIST Failure/)).not.toBeInTheDocument();
  });

  it("filters by search text (debounced, executed in the worker)", async () => {
    const model = imlModel();
    render(<ImlTab client={fakeClient(rowsFrom(model))} />);
    await screen.findByText(/BIST Failure/);
    fireEvent.change(screen.getByPlaceholderText(/Search messages/), {
      target: { value: "BIST" },
    });
    await waitFor(() =>
      expect(screen.queryByText(/Server reset/)).not.toBeInTheDocument()
    );
    expect(screen.getByText(/BIST Failure/)).toBeInTheDocument();
  });

  it("shows total vs shown counters", async () => {
    const model = imlModel();
    render(<ImlTab client={fakeClient(rowsFrom(model))} />);
    await screen.findByText(/BIST Failure/);
    expect(screen.getByText("3 total · 3 shown")).toBeInTheDocument();
  });
});

describe("FirmwareTab", () => {
  it("renders normalized firmware with hex badge", () => {
    const model = makeModel({
      firmware: [
        {
          component: "System CPLD",
          version: "0x30",
          displayVersion: "0x30",
          category: "CPLD",
          date: null,
          format: "hex",
          description: "Complex Programmable Logic Device.",
          source: "bcert.pkg",
        },
        {
          component: "iLO (Lights-Out Management)",
          version: "2.16",
          displayVersion: "2.16",
          category: "iLO",
          date: "05/13/2020",
          format: "decimal",
          source: "bcert.pkg",
        },
      ],
    });
    render(<FirmwareTab model={model} />);
    expect(screen.getByText("System CPLD")).toBeInTheDocument();
    expect(screen.getByText("0x30")).toBeInTheDocument();
    expect(screen.getByText("hex")).toBeInTheDocument();
    expect(screen.getByText("iLO (Lights-Out Management)")).toBeInTheDocument();
    expect(screen.getByText(/Complex Programmable Logic Device/)).toBeInTheDocument();
    // Firmware tab only shows versions - advisories live in the Tips tab.
    expect(screen.queryByText(/Known firmware advisories/)).not.toBeInTheDocument();
  });

  it("shows empty state when there is no firmware", () => {
    render(<FirmwareTab model={makeModel({ firmware: [], advisories: [] })} />);
    expect(screen.getByText(/No firmware information extracted/)).toBeInTheDocument();
  });
});

describe("TipsTab", () => {
  it("renders known firmware advisories for the server", () => {
    const model = makeModel({
      advisories: [
        {
          id: "a00117806en_us",
          title: "False Uncorrectable Memory Errors after System ROM 2.50",
          description:
            "A firmware fault in the Extended Memory Test algorithm causes false Uncorrectable Memory Errors.",
          component: "System ROM",
          affectedVersions: { min: "2.50", max: "2.53" },
          fixedIn: "2.54",
          severity: "critical",
          resolvesErrorCodes: ["0032|0462", "0005|0003"],
          results: [
            {
              component: "System ROM (family U32)",
              version: "2.50",
              affected: true,
              label: "System ROM 2.50 is AFFECTED by this known issue.",
              fix: "Update System ROM to 2.54 or later.",
            },
          ],
        },
      ],
    });
    render(<TipsTab model={model} />);
    expect(screen.getByText(/Known firmware advisories for this server/)).toBeInTheDocument();
    expect(screen.getByText("False Uncorrectable Memory Errors after System ROM 2.50")).toBeInTheDocument();
    expect(screen.getByText(/System ROM 2.50 is AFFECTED/)).toBeInTheDocument();
    expect(screen.getByText(/Update System ROM to 2.54 or later/)).toBeInTheDocument();
  });

  it("shows empty state when there are no advisories", () => {
    render(<TipsTab model={makeModel({ advisories: [] })} />);
    expect(screen.getByText(/No known firmware advisories/)).toBeInTheDocument();
  });
});

describe("EventsTab (worker-backed)", () => {
  function eventRows(): LogRow[] {
    return [
      {
        date: "07/09/2024 11:11:30",
        severity: "information",
        message: "Firmware update success from localhost",
        alarm: "Firmware update success from localhost",
        classCode: 0x20,
        eventCode: 0x0002,
      },
      {
        date: "07/09/2024 10:43:05",
        severity: "information",
        message: "Server reset.",
        alarm: "Server reset.",
        classCode: 0x20,
        eventCode: 0x0001,
      },
      {
        date: "07/09/2024 10:00:00",
        severity: "warning",
        message: "Host REST login: user1",
        alarm: "Host REST login: user1",
        classCode: 0x23,
        eventCode: 0x0046,
      },
    ];
  }

  it("shows plain-text events with date, severity and message (no codes)", async () => {
    const { container } = render(<EventsTab client={fakeClient(eventRows())} />);
    await screen.findByText("Firmware update success from localhost");
    expect(screen.getByText("Server reset.")).toBeInTheDocument();
    expect(screen.getByText("Host REST login: user1")).toBeInTheDocument();
    // no hex class/event codes rendered
    expect(container.textContent).not.toContain("0x20");
    expect(container.textContent).not.toContain("0x0023");
  });

  it("filters events by severity", async () => {
    render(<EventsTab client={fakeClient(eventRows())} />);
    await screen.findByText("Firmware update success from localhost");
    fireEvent.click(screen.getByRole("button", { name: "Warning" }));
    await waitFor(() =>
      expect(screen.getByText("Host REST login: user1")).toBeInTheDocument()
    );
    expect(screen.queryByText("Server reset.")).not.toBeInTheDocument();
  });

  it("filters events by search text", async () => {
    render(<EventsTab client={fakeClient(eventRows())} />);
    await screen.findByText("Firmware update success from localhost");
    fireEvent.change(screen.getByPlaceholderText(/Search events/), {
      target: { value: "Server reset" },
    });
    await waitFor(() =>
      expect(screen.queryByText("Firmware update success from localhost")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Server reset.")).toBeInTheDocument();
  });
});

describe("HardwareTab", () => {
  it("renders hardware components grouped by type", () => {
    const model = makeModel({
      hardware: [
        { type: "cpu", model: "AMD EPYC 7513", cores: "32", source: "bcert.pkg" },
        { type: "memory", model: "DIMM,8GB", slot: "DIMM 1", source: "bcert.pkg" },
      ],
    });
    render(<HardwareTab model={model} />);
    expect(screen.getByText("AMD EPYC 7513")).toBeInTheDocument();
    expect(screen.getByText("DIMM,8GB")).toBeInTheDocument();
    expect(screen.getByText("Cores")).toBeInTheDocument();
  });

  it("renders the exact error alarms that produced the status", () => {
    const model = makeModel({
      hardware: [
        {
          type: "power-supply",
          slot: "Power Supply 1",
          status: "failed",
          source: "bcert.pkg",
          issues: [
            {
              date: "03/04/2024 10:00:00",
              severity: "critical",
              message: "Uncorrectable Error Detected (Power Supply 3)",
            },
          ],
        },
      ],
    });
    render(<HardwareTab model={model} />);
    expect(screen.getByText(/Errors detected/)).toBeInTheDocument();
    expect(screen.getByText("Uncorrectable Error Detected (Power Supply 3)")).toBeInTheDocument();
    expect(screen.getByText("03/04/2024 10:00:00")).toBeInTheDocument();
  });

  it("renders board firmware and total memory on the system card", () => {
    const model = makeModel({
      hardware: [
        {
          type: "system-board",
          model: "ProLiant DL360 Gen10",
          source: "bcert.pkg",
          totalSystemMemory: "196 GB",
          systemRomVersion: "2.64",
          iloVersion: "2.16",
        },
      ],
    });
    render(<HardwareTab model={model} />);
    expect(screen.getByText("Total system memory")).toBeInTheDocument();
    expect(screen.getByText("196 GB")).toBeInTheDocument();
    expect(screen.getByText("System ROM")).toBeInTheDocument();
    expect(screen.getByText("2.64")).toBeInTheDocument();
    expect(screen.getByText("iLO")).toBeInTheDocument();
  });
});

describe("RcaTab", () => {
  it("renders critical alarm, resolution and repetitions", () => {
    const model = makeModel({
      rca: [
        {
          title: "Processor Built-In Self-Test (BIST) Failure",
          components: ["Processor 0"],
          resolution: "Reset the system.",
          bugs: [],
          severity: "critical",
          classCode: 0x32,
          eventCode: 0x3013,
          docUrl: "https://support.hpe.com",
          count: 3,
          lastDate: "01/02/2024 03:04:05",
          lastTimestamp: 1,
        },
      ],
    });
    render(<RcaTab model={model} />);
    expect(screen.getByText("Processor Built-In Self-Test (BIST) Failure")).toBeInTheDocument();
    expect(screen.getByText("Reset the system.")).toBeInTheDocument();
    expect(screen.getByText(/Repeated 3 times/)).toBeInTheDocument();
    expect(screen.getByText(/Affected: Processor 0/)).toBeInTheDocument();
  });

  it("shows a firmware advisory with affected/fixed version", () => {
    const model = makeModel({
      rca: [
        {
          title: "Uncorrectable Memory Error Threshold Exceeded",
          components: ["Processor 1", "DIMM 10"],
          resolution: "Take corrective action for the failing DIMM.",
          bugs: [
            {
              id: "a00117806en_us",
              title: "False Uncorrectable Memory Errors after System ROM 2.50",
              description:
                "A firmware fault causes false Uncorrectable Memory Errors. The DIMMs are NOT faulty.",
              component: "System ROM",
              affectedVersions: { min: "2.50", max: "2.53" },
              fixedIn: "2.54",
              severity: "critical",
              results: [
                {
                  component: "System ROM (family U32)",
                  version: "2.50",
                  affected: true,
                  label: "System ROM 2.50 is AFFECTED by this known issue.",
                  fix: "Update System ROM to 2.54 or later.",
                },
              ],
            },
          ],
          severity: "critical",
          classCode: 0x32,
          eventCode: 0x0462,
          docUrl: "https://support.hpe.com",
          count: 9,
          lastDate: "03/15/2024 10:20:30",
          lastTimestamp: 1,
        },
      ],
    });
    render(<RcaTab model={model} />);
    expect(screen.getByText("False Uncorrectable Memory Errors after System ROM 2.50")).toBeInTheDocument();
    expect(screen.getByText(/A firmware fault causes false/)).toBeInTheDocument();
    expect(screen.getByText(/System ROM 2.50 is AFFECTED/)).toBeInTheDocument();
    expect(screen.getByText(/Update System ROM to 2.54 or later/)).toBeInTheDocument();
  });

  it("does not show the raw class/event code", () => {
    const model = makeModel({
      rca: [
        {
          title: "Uncorrectable Machine Check Exception",
          components: ["Processor 2"],
          resolution: null,
          bugs: [],
          severity: "critical",
          classCode: 0x0005,
          eventCode: 0x0003,
          docUrl: "https://support.hpe.com",
          count: 5,
          lastDate: "01/02/2024 03:04:05",
          lastTimestamp: 1,
        },
      ],
    });
    const { container } = render(<RcaTab model={model} />);
    expect(container.textContent).not.toContain("0x0005");
    expect(container.textContent).not.toContain("0x0003");
    expect(screen.getByText("Uncorrectable Machine Check Exception")).toBeInTheDocument();
  });

  it("shows empty state when no critical events", () => {
    render(<RcaTab model={makeModel({ rca: [] })} />);
    expect(screen.getByText(/No critical events detected/)).toBeInTheDocument();
  });
});
