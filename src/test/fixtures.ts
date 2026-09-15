// Shared fixtures for renderer component tests.
import type { ImlEntry, Model } from "../types";

export function iml(
  overrides: Partial<ImlEntry> = {}
): ImlEntry {
  return {
    date: "01/02/2024 03:04:05",
    id: 1,
    classCode: 0,
    eventCode: 0,
    logType: "iml",
    severity: "information",
    message: "A test message.",
    alarm: "A test message.",
    resolution: null,
    timestamp: 1,
    source: "test.zbb",
    ...overrides,
  };
}

export function makeModel(partial: Partial<Model> = {}): Model {
  return {
    meta: { serialNumber: "ABC123", productName: "ProLiant DL360 Gen10" },
    customerInfo: null,
    fileListing: [],
    clist: [],
    counters: [],
    firmware: [],
    hardware: [],
    iml: [],
    events: [],
    rca: [],
    advisories: [],
    stats: {
      records: 0,
      zbbFiles: 0,
      imlCount: 0,
      eventCount: 0,
      criticalCount: 0,
      warningCount: 0,
    },
    ...partial,
  };
}
