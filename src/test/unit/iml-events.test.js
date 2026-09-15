import { describe, it, expect } from "vitest";
import { IML_EVENTS, getImlEvent } from "../../adapters/kb/iml-events.js";
import { IML_RESOLUTIONS, IML_DB_SIZE } from "../../adapters/kb/iml-resolutions.js";

const VALID_SEVERITY = ["critical", "warning", "information"];
const VALID_CATEGORY = [
  "memory",
  "processor",
  "power",
  "cooling",
  "storage",
  "network",
  "pcie",
  "security",
  "firmware",
  "ilo",
  "enclosure",
  "system",
];

describe("iml-events database", () => {
  it("is comprehensive (covers the guide's event catalogue)", () => {
    expect(IML_EVENTS.length).toBeGreaterThanOrEqual(500);
  });

  it("has unique class|event keys", () => {
    const seen = new Set();
    for (const e of IML_EVENTS) {
      const key = `${e.class.toString(16).padStart(4, "0")}|${e.event
        .toString(16)
        .padStart(4, "0")}`;
      expect(seen.has(key), `duplicate key ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("every event has valid severity and category", () => {
    for (const e of IML_EVENTS) {
      expect(VALID_SEVERITY).toContain(e.severity);
      expect(VALID_CATEGORY).toContain(e.category);
    }
  });

  it("every event carries official title, symptom, cause and resolution", () => {
    for (const e of IML_EVENTS) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.symptom.length).toBeGreaterThan(0);
      expect(e.cause.length).toBeGreaterThan(0);
      expect(e.action.length).toBeGreaterThan(0);
      expect(e.url).toContain("class0x");
    }
  });

  it("links official doc URLs to the guide", () => {
    const ue = getImlEvent(0x0a, 0x0469);
    expect(ue).not.toBeNull();
    expect(ue.url).toContain("ilogen12-msg-en_us");
    expect(ue.url).toContain("class0x000acode0x0469");
  });

  it("covers Gen10/Gen11 hardware classes", () => {
    // Processor, memory, power, cooling, storage and network classes.
    const classes = new Set(IML_EVENTS.map((e) => e.class));
    for (const c of [0x0002, 0x0003, 0x0005, 0x0008, 0x000a, 0x000b, 0x0011, 0x0013]) {
      expect(classes.has(c), `missing class 0x${c.toString(16)}`).toBe(true);
    }
  });
});

describe("iml-resolutions integration", () => {
  it("builds the resolution map from the database", () => {
    expect(IML_DB_SIZE).toBeGreaterThanOrEqual(500);
    expect(Object.keys(IML_RESOLUTIONS).length).toBeGreaterThanOrEqual(
      IML_DB_SIZE
    );
  });

  it("known critical codes are present and critical", () => {
    const codes = [
      "0005|0003",
      "0008|0002",
      "000a|0467",
      "000a|0469",
      "0032|0462",
      "0032|3013",
    ];
    for (const code of codes) {
      expect(IML_RESOLUTIONS[code], `missing ${code}`).toBeDefined();
    }
    expect(IML_RESOLUTIONS["0032|0462"].severity).toBe("critical");
    expect(IML_RESOLUTIONS["0005|0003"].severity).toBe("critical");
  });
});