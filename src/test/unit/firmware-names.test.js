import { describe, it, expect } from "vitest";
import { normalizeFirmware } from "../../domain/services/firmware-names.js";

describe("normalizeFirmware", () => {
  it("maps SystemProgrammableLogicDevice to System CPLD with hex format", () => {
    const f = normalizeFirmware("SystemProgrammableLogicDevice", "0x31", "bcert");
    expect(f.component).toBe("System CPLD");
    expect(f.category).toBe("CPLD");
    expect(f.format).toBe("hex");
    expect(f.version).toBe("0x31");
  });

  it("maps Fulton to Power Management Controller", () => {
    const f = normalizeFirmware("Fulton", "1.0.7", "bcert");
    expect(f.component).toBe("Power Management Controller (PMC)");
    expect(f.category).toBe("Power Management");
    expect(f.format).toBe("decimal");
  });

  it("maps a System ROM family code (U32) to a readable name", () => {
    const f = normalizeFirmware("U32", "04/08/2020", "bcert");
    expect(f.component).toContain("System ROM");
    expect(f.component).toContain("U32");
    expect(f.category).toBe("System ROM (BIOS)");
    expect(f.date).toBe("04/08/2020");
  });

  it("splits iLO version + date", () => {
    const f = normalizeFirmware("IntegratedLights-OutV", "2.16 - 05/13/2020", "bcert");
    expect(f.component).toBe("iLO (Lights-Out Management)");
    expect(f.version).toBe("2.16");
    expect(f.date).toBe("05/13/2020");
  });

  it("splits ROM version 'v2.34 (04/08/2020)'", () => {
    const f = normalizeFirmware("System ROM", "v2.34 (04/08/2020)", "zbb");
    expect(f.component).toBe("BIOS (System ROM)");
    expect(f.version).toBe("2.34");
    expect(f.date).toBe("04/08/2020");
    expect(f.format).toBe("rom");
  });

  it("maps redundant System ROM", () => {
    const f = normalizeFirmware("Redundant System ROM", "v2.34 (04/08/2020)", "zbb");
    expect(f.component).toBe("Redundant System ROM");
    expect(f.category).toBe("System ROM (BIOS)");
  });

  it("maps a NIC internal part name (_331i)", () => {
    const f = normalizeFirmware("_331i", "20.14.57", "bcert");
    expect(f.component).toBe("HPE Ethernet 1Gb 4-port 331i");
    expect(f.category).toBe("Network");
  });

  it("maps a drive model key to storage drive", () => {
    const f = normalizeFirmware("VK000240GWTSV", "HPG3", "bcert");
    expect(f.component).toBe("Storage drive (VK000240GWTSV)");
    expect(f.category).toBe("Storage drive");
  });

  it("maps TPM keys to Trusted Platform Module", () => {
    const f = normalizeFirmware("STMicroGen10PlusTPM", "73.64", "bcert");
    expect(f.component).toBe("TPM (Trusted Platform Module)");
    expect(f.category).toBe("Security (TPM)");
  });

  it("maps the I350-T4 OCP3 NIC key to a readable name", () => {
    const f = normalizeFirmware("HPE1GbE4PBaseTI350-T4OCP3Adptr", "1.3310.0", "bcert");
    expect(f.component).toBe("HPE Ethernet 1Gb 4-port I350-T4 OCP3 Adapter");
    expect(f.category).toBe("Network");
  });

  it("maps a Smart Array controller key", () => {
    const f = normalizeFirmware("P408i-a", "4.11", "bcert");
    expect(f.component).toBe("HPE Smart Array P408i-a");
    expect(f.category).toBe("Storage controller");
  });

  it("includes a human description for CPLD", () => {
    const f = normalizeFirmware("SystemProgrammableLogicDevice", "0x30", "bcert");
    expect(f.description).toMatch(/logic device/i);
    expect(f.formatNote).toMatch(/hexadecimal/i);
  });
});
