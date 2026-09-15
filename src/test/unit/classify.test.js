import { describe, it, expect } from "vitest";
import { classifyBcert } from "../../adapters/parsers/classify.js";
import { parseBcert } from "../../adapters/parsers/subformats.js";

const te = new TextEncoder();

describe("classifyBcert", () => {
  it("extracts firmware, hardware and meta from MfgRecord", () => {
    const xml = `<BC><MfgRecord>
      <FirmwareLockdown>
        <IntegratedLights-OutV>2.16</IntegratedLights-OutV>
        <U32>04/08/2020</U32>
      </FirmwareLockdown>
      <StorageController>
        <Model>HPE S100i</Model>
        <Slot>0b</Slot>
      </StorageController>
      <HardDrive>
        <Model>ATA VK000240</Model>
        <SerialNumber>PHYF123</SerialNumber>
      </HardDrive>
      <DiagProcess>
        <SerialNumber>SGH123</SerialNumber>
        <ProductName>ProLiant DL360 Gen10</ProductName>
      </DiagProcess>
    </MfgRecord></BC>`;

    const c = classifyBcert(parseBcert(te.encode(xml)));

    expect(c.firmware.some((f) => f.component === "IntegratedLights-OutV")).toBe(
      true
    );
    expect(c.hardware.some((h) => h.type === "storage-controller")).toBe(true);
    expect(c.hardware.some((h) => h.type === "hard-drive")).toBe(true);
    expect(c.meta.serialNumber).toBe("SGH123");
    expect(c.meta.productName).toBe("ProLiant DL360 Gen10");
  });

  it("tags sources", () => {
    const xml = `<BC><MfgRecord><FirmwareLockdown><A>1</A></FirmwareLockdown></MfgRecord></BC>`;
    const c = classifyBcert(parseBcert(te.encode(xml)));
    expect(c.firmware[0].source).toContain("FirmwareLockdown");
  });
});
