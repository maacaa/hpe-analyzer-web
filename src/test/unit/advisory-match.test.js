import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, isAffected } from "../../domain/services/version-match.js";
import { matchAdvisories, matchAdvisoriesForError, matchGeneralAdvisories } from "../../adapters/kb/advisory-match.js";
import { FIRMWARE_ADVISORIES } from "../../adapters/kb/firmware-advisories.js";

describe("parseVersion", () => {
  it("parses dotted numeric versions", () => {
    expect(parseVersion("2.54")).toEqual([2, 54]);
    expect(parseVersion("04.01.04.505")).toEqual([4, 1, 4, 505]);
    expect(parseVersion("0.2.2.3")).toEqual([0, 2, 2, 3]);
  });
  it("strips patch suffixes and leading v", () => {
    expect(parseVersion("2.90p20")).toEqual([2, 90]);
    expect(parseVersion("v2.34")).toEqual([2, 34]);
  });
  it("returns null for hex (CPLD)", () => {
    expect(parseVersion("0x31")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders versions", () => {
    expect(compareVersions(parseVersion("2.54"), parseVersion("2.90"))).toBeLessThan(0);
    expect(compareVersions(parseVersion("2.53"), parseVersion("2.54"))).toBeLessThan(0);
    expect(compareVersions(parseVersion("3.00"), parseVersion("2.54"))).toBeGreaterThan(0);
  });
});

describe("isAffected", () => {
  it("detects a version inside an affected range", () => {
    expect(isAffected("2.50", { min: "2.50", max: "2.53" })).toBe(true);
    expect(isAffected("2.53", { min: "2.50", max: "2.53" })).toBe(true);
  });
  it("detects a version outside the affected range", () => {
    expect(isAffected("2.54", { min: "2.50", max: "2.53" })).toBe(false);
    expect(isAffected("2.49", { min: "2.50", max: "2.53" })).toBe(false);
  });
  it("handles 'prior to' (max only) advisories", () => {
    expect(isAffected("2.29", { max: "2.29" })).toBe(true);
    expect(isAffected("2.30", { max: "2.29" })).toBe(false);
  });
});

describe("matchAdvisoriesForError", () => {
  const firmware = [
    { component: "System ROM (family U32)", version: "2.50", category: "System ROM (BIOS)" },
    { component: "iLO (Lights-Out Management)", version: "3.05", category: "iLO" },
  ];

  it("matches false UMCE advisory for the memory error code and reports AFFECTED", () => {
    const matches = matchAdvisoriesForError("0032|0462", firmware, "Gen10");
    expect(matches.length).toBeGreaterThan(0);
    const adv = matches.find((m) => m.id === "a00117806en_us");
    expect(adv).toBeDefined();
    expect(adv.results[0].affected).toBe(true);
    expect(adv.results[0].fix).toMatch(/2\.54/);
  });

  it("reports NOT affected when the version already contains the fix", () => {
    const patched = [
      { component: "System ROM (family U32)", version: "2.54", category: "System ROM (BIOS)" },
    ];
    const matches = matchAdvisoriesForError("0032|0462", patched, "Gen10");
    const adv = matches.find((m) => m.id === "a00117806en_us");
    expect(adv.results[0].affected).toBe(false);
  });

  it("matches iLO reset advisory for machine check exception", () => {
    const matches = matchAdvisoriesForError("0005|0003", firmware, "Gen10");
    const adv = matches.find((m) => m.id === "a00141858en_us");
    expect(adv).toBeDefined();
    expect(adv.results[0].affected).toBe(true);
  });
});

describe("matchGeneralAdvisories", () => {
  it("surfaces advisories without resolvesErrorCodes when the version is affected", () => {
    const firmware = [
      { component: "Smart Array P408i-a", version: "2.50", category: "Storage controller" },
    ];
    const matches = matchGeneralAdvisories(firmware, "Gen10");
    const adv = matches.find((m) => m.id === "a00097210en_us"); // data inconsistency, no error codes
    expect(adv).toBeDefined();
    expect(adv.results[0].affected).toBe(true);
  });

  it("hides an advisory for a patched version (TIPS policy)", () => {
    const firmware = [
      { component: "Smart Array P408i-a", version: "2.65", category: "Storage controller" },
    ];
    const matches = matchGeneralAdvisories(firmware, "Gen10");
    expect(matches.find((m) => m.id === "a00097210en_us")).toBeUndefined();
  });

  it("skips advisories whose component is not present in the server", () => {
    const matches = matchGeneralAdvisories(
      [{ component: "System ROM (family U32)", version: "2.50" }],
      "Gen10"
    );
    expect(matches.find((m) => m.id === "a00097210en_us")).toBeUndefined();
  });

  it("respects the platform filter", () => {
    const firmware = [{ component: "System ROM", version: "2.50" }];
    const gen11 = matchGeneralAdvisories(firmware, "Gen11");
    expect(gen11.find((m) => m.id === "a00117806en_us")).toBeUndefined();
    const gen10 = matchGeneralAdvisories(firmware, "Gen10");
    expect(gen10.find((m) => m.id === "a00117806en_us")).toBeDefined();
  });

  it("matches by firmware version regardless of IML error codes", () => {
    const firmware = [{ component: "System ROM", version: "2.50" }];
    const matches = matchGeneralAdvisories(firmware, "Gen10");
    // An advisory that normally only appears for a specific IML error code is
    // now also reachable purely from the firmware version.
    expect(matches.some((m) => m.id === "a00117806en_us")).toBe(true);
  });

  it("TIPS policy: hides an advisory when no installed version is affected", () => {
    // System ROM 2.64 is above every Gen10 ROM advisory's affected range.
    const firmware = [{ component: "System ROM", version: "2.64" }];
    const matches = matchGeneralAdvisories(firmware, "Gen10");
    expect(matches.some((m) => m.id === "a00117806en_us")).toBe(false);
    expect(matches.find((m) => m.id === "a00096318en_us")).toBeUndefined();
  });

  it("TIPS policy: keeps only affected versions inside a matched advisory", () => {
    const firmware = [
      { component: "System ROM", version: "2.50" },           // affected by a00117806en_us
      { component: "System ROM", version: "2.56" },           // healthy (dedupe by name keeps both)
    ];
    const matches = matchGeneralAdvisories(firmware, "Gen10");
    const adv = matches.find((m) => m.id === "a00117806en_us");
    expect(adv).toBeDefined();
    expect(adv.results.every((r) => r.affected)).toBe(true);
    expect(adv.results.some((r) => r.version === "2.50")).toBe(true);
  });

  it("TIPS policy: unaffected rates are never part of the results", () => {
    const firmware = [{ component: "Smart Array P408i-a", version: "2.62" }];
    const matches = matchGeneralAdvisories(firmware, "Gen10");
    for (const adv of matches) {
      expect(adv.results.every((r) => r.affected)).toBe(true);
    }
  });

  it("RCA advisories are NOT filtered by health (affected ok entries allowed)", () => {
    const patched = [
      { component: "System ROM (family U32)", version: "2.54", category: "System ROM (BIOS)" },
    ];
    const matches = matchAdvisoriesForError("0032|0462", patched, "Gen10");
    const adv = matches.find((m) => m.id === "a00117806en_us");
    expect(adv.results[0].affected).toBe(false); // RCA keeps the informational result
  });
});
