// @ts-check
// Firmware component dictionary: maps HPE-internal keys to human-readable
// names, categories, version formats and a plain-language description.
//
// Sources: HPE Gen10/Gen11 SPP release notes, iLO 5/6 Redfish schema, and
// dmidecode HPE OEM records (216/245). Confirmed relationships:
//   - "System Programmable Logic Device" = CPLD (version is a single HEX value)
//   - "Uxx"/"Axx"/"Ixx" = System ROM family codes (Intel/AMD/blade)
//   - "Fulton" = Power Management Controller (PMC/PMIC)
//   - "ServerPlatformServicesSPSFirmware" = Intel SPS (Management Engine)
//   - "InnovationEngineIEFirmware" = Intel Innovation Engine
//   - "STMicroGen10PlusTPM" = STMicroelectronics Trusted Platform Module
//   - "_xxx" = HPE network adapter internal part name

const CATEGORY = {
  ILO: "iLO",
  ROM: "System ROM (BIOS)",
  CPLD: "CPLD",
  ME: "Intel ME / SPS / IE",
  POWER: "Power Management",
  NETWORK: "Network",
  STORAGE_CTRL: "Storage controller",
  STORAGE_DRIVE: "Storage drive",
  SECURITY: "Security (TPM)",
  RISER: "Riser / option card",
  OTHER: "Other",
};

// Exact-key map (bcert FirmwareLockdown and zbb field names).
/** @type {Record<string, {name:string, category:string, format:string, description:string}>} */
const EXACT = {
  "IntegratedLights-OutV": { name: "iLO (Lights-Out Management)", category: CATEGORY.ILO, format: "version-date", description: "Integrated Lights-Out — the remote management processor firmware." },
  "IntegratedLights-OutVI": { name: "iLO (Lights-Out Management)", category: CATEGORY.ILO, format: "version-date", description: "Integrated Lights-Out — the remote management processor firmware." },
  "iLO Version": { name: "iLO (Lights-Out Management)", category: CATEGORY.ILO, format: "version-date", description: "Integrated Lights-Out — the remote management processor firmware." },
  "iLO": { name: "iLO (Lights-Out Management)", category: CATEGORY.ILO, format: "decimal", description: "Integrated Lights-Out — the remote management processor firmware." },

  "InnovationEngineIEFirmware": { name: "Intel Innovation Engine (IE)", category: CATEGORY.ME, format: "decimal", description: "Intel Innovation Engine — an auxiliary management processor on the chipset." },
  "ServerPlatformServicesSPSFirmware": { name: "Intel SPS (Server Platform Services)", category: CATEGORY.ME, format: "decimal", description: "Intel Server Platform Services (Management Engine) firmware." },

  "SystemProgrammableLogicDevice": { name: "System CPLD", category: CATEGORY.CPLD, format: "hex", description: "Complex Programmable Logic Device — a programmable chip on the system board. Its version is a hexadecimal value (e.g. 0x30), not a decimal number." },
  "SecondarySystemProgrammableLogicDevice": { name: "Secondary CPLD", category: CATEGORY.CPLD, format: "hex", description: "Secondary Complex Programmable Logic Device — hexadecimal version value." },
  "CPLD Version": { name: "System CPLD", category: CATEGORY.CPLD, format: "hex", description: "Complex Programmable Logic Device — hexadecimal version value." },

  "Fulton": { name: "Power Management Controller (PMC)", category: CATEGORY.POWER, format: "decimal", description: "Power Management Controller (PMC/PMIC) — manages platform power sequencing." },
  "Power Management Controller Firmware": { name: "Power Management Controller (PMC)", category: CATEGORY.POWER, format: "decimal", description: "Power Management Controller (PMC/PMIC) firmware." },
  "Power Management Controller FW Bootloader": { name: "Power Management Controller (Bootloader)", category: CATEGORY.POWER, format: "decimal", description: "Power Management Controller bootloader." },

  "System ROM": { name: "System ROM", category: CATEGORY.ROM, format: "rom", description: "System ROM (BIOS/UEFI) — the main server firmware." },
  "Redundant System ROM": { name: "Redundant System ROM", category: CATEGORY.ROM, format: "rom", description: "Redundant/backup copy of the System ROM used for recovery." },

  "STMicroGen10PlusTPM": { name: "TPM (Trusted Platform Module)", category: CATEGORY.SECURITY, format: "decimal", description: "STMicroelectronics Trusted Platform Module — cryptographic security chip firmware." },
  "STMicroGen11TPM": { name: "TPM (Trusted Platform Module)", category: CATEGORY.SECURITY, format: "decimal", description: "STMicroelectronics Trusted Platform Module — cryptographic security chip firmware." },

  "HPE1GbE4PBaseTI350-T4OCP3Adptr": { name: "HPE Ethernet 1Gb 4-port I350-T4 OCP3 Adapter", category: CATEGORY.NETWORK, format: "decimal", description: "HPE Ethernet 1Gb 4-port BASE-T Intel I350-T4 OCP3 network adapter." },
  "_331i": { name: "HPE Ethernet 1Gb 4-port 331i", category: CATEGORY.NETWORK, format: "decimal", description: "Embedded HPE Ethernet 1Gb 4-port 331i adapter." },
  "_331FLR": { name: "HPE Ethernet 1Gb 4-port 331FLR", category: CATEGORY.NETWORK, format: "decimal", description: "FlexibleLOM HPE Ethernet 1Gb 4-port 331FLR adapter." },
  "_366FLR": { name: "HPE Ethernet 1Gb 4-port 366FLR", category: CATEGORY.NETWORK, format: "decimal", description: "FlexibleLOM HPE Ethernet 1Gb 4-port 366FLR adapter." },
  "_536FLR-T": { name: "HPE Ethernet 1Gb 4-port 536FLR-T", category: CATEGORY.NETWORK, format: "decimal", description: "FlexibleLOM HPE Ethernet 1Gb 4-port 536FLR-T adapter." },

  "P408i-a": { name: "HPE Smart Array P408i-a", category: CATEGORY.STORAGE_CTRL, format: "decimal", description: "HPE Smart Array P408i-a Gen10 storage controller." },
  "E208i-a": { name: "HPE Smart Array E208i-a", category: CATEGORY.STORAGE_CTRL, format: "decimal", description: "HPE Smart Array E208i-a Gen10 storage controller." },

  "PrimaryR05x16-x16-Gen5Option": { name: "Primary riser (x16/x16 Gen5)", category: CATEGORY.RISER, format: "decimal", description: "Primary PCIe riser board (x16/x16 Gen5) firmware." },
  "SecondaryR09x16NVMeSlimSASGen5": { name: "Secondary riser (NVMe/SAS Gen5)", category: CATEGORY.RISER, format: "decimal", description: "Secondary riser board (x16 NVMe/SlimSAS Gen5) firmware." },

  "UBM6": { name: "Universal Backplane Manager (UBM6)", category: CATEGORY.OTHER, format: "decimal", description: "Universal Backplane Manager — drive backplane controller firmware." },
};

// System ROM family codes (value is a build date; version is "X.XX_MM-DD-YYYY").
const ROM_FAMILY_RE = /^(U|A|I)\d{2}$/;

const HEX_RE = /^0x[0-9a-f]+$/i;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DECIMAL_RE = /^\d+(\.\d+)+$/;
const ROM_RE = /^v?(\d+(?:\.\d+)+)\s*\((\d{2}\/\d{2}\/\d{4})\)$/;

/**
 * @param {string} value
 * @returns {"hex"|"rom"|"date"|"version-date"|"decimal"|"string"}
 */
function detectFormat(value) {
  if (HEX_RE.test(value)) return "hex";
  if (ROM_RE.test(value)) return "rom";
  if (DATE_RE.test(value)) return "date";
  if (/ - \d{2}\/\d{2}\/\d{4}$/.test(value)) return "version-date";
  if (DECIMAL_RE.test(value)) return "decimal";
  return "string";
}

/** Split "2.16 - 05/13/2020" into { version, date }. */
/**
 * @param {string} value
 * @returns {{version:string, date:string|null}}
 */
function splitVersionDate(value) {
  const m = /^(.+?)\s*-\s*(\d{2}\/\d{2}\/\d{4})$/.exec(value);
  if (m) return { version: m[1].trim(), date: m[2] };
  return { version: value, date: null };
}

/** Split "v2.34 (04/08/2020)" into { version, date }. */
/**
 * @param {string} value
 * @returns {{version:string, date:string|null}}
 */
function splitRom(value) {
  const m = ROM_RE.exec(value);
  if (m) return { version: m[1], date: m[2] };
  return { version: value.replace(/^v/, ""), date: null };
}

/** Human explanation of the version format. */
/**
 * @param {string} format
 * @returns {string}
 */
function formatNote(format) {
  switch (format) {
    case "hex":
      return "Hexadecimal version value (not a decimal number).";
    case "rom":
    case "version-date":
      return "Version with its build date.";
    case "date":
      return "Build date (the version is not reported here).";
    default:
      return "";
  }
}

/**
 * Normalize a firmware component into a display-friendly object.
 * @param {string} key    raw internal key (e.g. "SystemProgrammableLogicDevice")
 * @param {string} value  raw version string (e.g. "0x31")
 * @param {string} source provenance (bcert / zbb / inline)
 * @returns {import("../entities/model.js").FirmwareEntry}
 */
export function normalizeFirmware(key, value, source) {
  const v = String(value).trim();
  const fmt = detectFormat(v);
  const sd = fmt === "version-date" ? splitVersionDate(v) : fmt === "rom" ? splitRom(v) : null;

  const version = sd ? sd.version : v;
  const date = sd ? sd.date : fmt === "date" ? v : null;
  const displayVersion = v;

  if (EXACT[key]) {
    const e = /** @type {{name:string, category:string, format:string, description:string}} */ (EXACT[key]);
    return {
      component: e.name,
      category: e.category,
      description: e.description,
      version,
      displayVersion,
      date,
      format: fmt,
      formatNote: formatNote(fmt),
      source,
      rawKey: key,
    };
  }

  if (ROM_FAMILY_RE.test(key)) {
    const platform = key[0] === "U" ? "Intel" : key[0] === "A" ? "AMD" : "Blade";
    return {
      component: `System ROM (${platform}, family ${key})`,
      category: CATEGORY.ROM,
      description: "System ROM (BIOS/UEFI) family identifier and build date.",
      version,
      displayVersion,
      date,
      format: fmt,
      formatNote: formatNote(fmt),
      source,
      rawKey: key,
    };
  }

  if (key.startsWith("_")) {
    return {
      component: `Network adapter (${key})`,
      category: CATEGORY.NETWORK,
      description: "Network adapter firmware.",
      version,
      displayVersion,
      date,
      format: fmt,
      formatNote: formatNote(fmt),
      source,
      rawKey: key,
    };
  }

  // Storage drive model key (e.g. "VK000240GWTSV")
  if (/^[A-Z0-9]{6,}$/.test(key)) {
    return {
      component: `Storage drive (${key})`,
      category: CATEGORY.STORAGE_DRIVE,
      description: "Storage drive firmware, keyed by drive model number.",
      version,
      displayVersion,
      date,
      format: fmt,
      formatNote: formatNote(fmt),
      source,
      rawKey: key,
    };
  }

  return {
    component: key,
    category: CATEGORY.OTHER,
    description: "",
    version,
    displayVersion,
    date,
    format: fmt,
    formatNote: formatNote(fmt),
    source,
    rawKey: key,
  };
}
