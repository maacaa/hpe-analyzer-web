// HPE ProLiant Gen10 / Gen11 firmware advisory database.
//
// Each advisory links a firmware component to a known bug, the affected
// version range, and the version containing the fix. Compared against the
// firmware versions extracted from the AHS file at analysis time.
//
// Sources: official HPE customer advisories (support.hpe.com) and SPP release
// notes. `component` is matched against the human-readable firmware component
// name produced by firmware-names.js (e.g. "System ROM", "iLO (Lights-Out
// Management)", "Power Management Controller (PMC)", "Intel SPS (Server
// Platform Services)", "Intel Innovation Engine (IE)").

export const FIRMWARE_ADVISORIES = [
  // ================= System ROM (Intel Gen10) =================
  {
    id: "a00117806en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { min: "2.50", max: "2.53" },
    fixedIn: "2.54",
    title: "False Uncorrectable Memory Errors after System ROM 2.50",
    description:
      "A firmware fault in the Extended Memory Test algorithm after updating to System ROM 2.50 causes false Uncorrectable Memory Errors and DIMM callout/mapout. The DIMMs are NOT faulty.",
    resolvesErrorCodes: ["0032|0462", "0005|0003"],
    severity: "critical",
  },
  {
    id: "a00096318en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { max: "2.29" },
    fixedIn: "2.30",
    title: "Unexpected reboot / Bank 7-8 Machine Check Exception",
    description:
      "Intel CPU errata causes unexpected reboots and Bank 7/8 Uncorrectable Machine Check Exceptions on systems using Fast Fault Tolerant (ADDDC) memory protection with System ROM earlier than 2.30.",
    resolvesErrorCodes: ["0005|0003", "0008|0002"],
    severity: "critical",
  },
  {
    id: "a00090359en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { max: "2.15" },
    fixedIn: "2.16",
    title: "Bank 3/4 Machine Check Exception on Xeon Scalable",
    description:
      "Intel Xeon Scalable processors may log Bank 3/4 Uncorrectable Machine Check Exceptions due to a processor sighting. Fixed via updated microcode in System ROM 2.16.",
    resolvesErrorCodes: ["0005|0003"],
    severity: "critical",
  },
  {
    id: "a00110879en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { max: "2.41" },
    fixedIn: "2.42",
    title: "Machine Check Exception (Intel CLX52/CLX53, SKX123 errata)",
    description:
      "Two Intel errata cause Uncorrectable Machine Check Exceptions (Bank 3, or Bank 9/A/B with posted interrupts). Fixed via microcode in System ROM 2.42.",
    resolvesErrorCodes: ["0005|0003"],
    severity: "critical",
  },
  {
    id: "a00126841en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { max: "2.67" },
    fixedIn: "2.68",
    title: "AVX Machine Check Exception (Intel SKX140 errata)",
    description:
      "Uncorrectable Machine Check Exception when executing AVX instructions on 1st-gen Xeon Scalable. Fixed via microcode in System ROM 2.68.",
    resolvesErrorCodes: ["0005|0003"],
    severity: "critical",
  },
  {
    id: "a00075704en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { max: "2.01" },
    fixedIn: "2.02",
    title: "Corrected errors reported as Uncorrectable",
    description:
      "Corrected (benign) machine-check events were incorrectly logged as Uncorrectable Machine Check Exceptions before System ROM 2.02.",
    resolvesErrorCodes: ["0005|0003"],
    severity: "warning",
  },
  {
    id: "a00092445en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { min: "2.20", max: "2.20" },
    fixedIn: "2.22",
    title: "LRDIMM Uncorrectable Memory Error on ROM 2.20",
    description:
      "A small subset of LRDIMMs could experience an Uncorrectable Memory Error on System ROM 2.20 (a fix from 2.14 was omitted).",
    resolvesErrorCodes: ["0032|0462"],
    severity: "critical",
  },
  {
    id: "a00108394en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { min: "2.30", max: "2.36" },
    fixedIn: "2.40",
    title: "POST reset loop at Memory Initialization (PPR)",
    description:
      "If POST Package Repair on a faulty DIMM fails, the server enters a reboot loop or hangs at Memory Initialization.",
    resolvesErrorCodes: [],
    severity: "critical",
  },
  {
    id: "a00120173en_us",
    component: "System ROM",
    platforms: ["Gen10"],
    affected: { max: "2.57" },
    fixedIn: "2.58",
    title: "Correctable Memory Error Threshold logged incorrectly",
    description:
      "BIOS logs 'Correctable Memory Error Threshold Exceeded' even when the system is NOT at increased risk of an uncorrectable error. Fixed in System ROM 2.58.",
    resolvesErrorCodes: [],
    severity: "warning",
  },

  // ================= System ROM (Gen10 Plus AMD) =================
  {
    id: "a00142450en_us",
    component: "System ROM",
    platforms: ["Gen10 Plus"],
    affected: { max: "3.19" },
    fixedIn: "3.20",
    title: "Bank 0x03 Machine Check Exception (AMD Milan)",
    description:
      "AMD EPYC 7003 systems log Bank 0x03 Uncorrectable Machine Check Exceptions and may hang or reboot. Fixed in System ROM 3.20 (adds 'AMD IC Config Disable IT Bypass').",
    resolvesErrorCodes: ["0005|0003"],
    severity: "critical",
  },

  // ================= System ROM (Gen11 Intel) =================
  {
    id: "a00144601en_us",
    component: "System ROM",
    platforms: ["Gen11"],
    affected: { max: "2.41" },
    fixedIn: "2.42",
    title: "DIMM initialization hang / UMCE with 2 DIMMs per channel",
    description:
      "With two DIMMs installed per channel, the system may hang at DIMM initialization or log Uncorrectable Memory Errors during intense memory use. Fixed in System ROM 2.42 with latest SPS firmware.",
    resolvesErrorCodes: ["0032|0462", "0005|0003"],
    severity: "critical",
  },
  {
    id: "a00144835en_us",
    component: "System ROM",
    platforms: ["Gen11"],
    affected: { max: "2.49" },
    fixedIn: "2.50",
    title: "Uncorrectable Memory Error after idle (Package C6)",
    description:
      "UMCE detected while idle with Package C6 enabled. Fixed in System ROM 2.50 paired with SPS 06.01.04.089.0.",
    resolvesErrorCodes: ["0032|0462", "0005|0003"],
    severity: "critical",
  },
  {
    id: "a00135305en_us",
    component: "System ROM",
    platforms: ["Gen11"],
    affected: { max: "1.47" },
    fixedIn: "1.48",
    title: "DL110 Gen11 Uncorrectable Memory Error (Xeon Gold MCC)",
    description:
      "With the default 'General Power Efficient Compute' profile, a UMCE may be logged. Fixed in System ROM 1.48.",
    resolvesErrorCodes: ["0005|0003"],
    severity: "critical",
  },
  {
    id: "a00142688en_us",
    component: "System ROM",
    platforms: ["Gen11"],
    affected: { max: "2.59" },
    fixedIn: "2.60",
    title: "Machine Check Exception on 5th-gen Xeon Scalable",
    description:
      "UMCE under the default 'General Power Efficient Compute' profile on 5th-gen Xeon Scalable. Fixed in System ROM 2.60.",
    resolvesErrorCodes: ["0005|0003"],
    severity: "critical",
  },
  {
    id: "a00156729en_us",
    component: "System ROM",
    platforms: ["Gen11"],
    affected: { max: "2.79" },
    fixedIn: "2.80",
    title: "Random runtime hang requiring power-cycle",
    description:
      "Infrequent runtime hang where NMI has no effect and a cold boot is required. Fixed in System ROM 2.80.",
    resolvesErrorCodes: [],
    severity: "critical",
  },

  // ================= System ROM (Gen11 AMD) =================
  {
    id: "a00156999en_us",
    component: "System ROM",
    platforms: ["Gen11"],
    affected: { max: "2.55" },
    fixedIn: "3.00",
    title: "DIMM initialization error / UMCE (AMD EPYC 4th gen)",
    description:
      "Boot-time memory initialization error or runtime uncorrectable error under heavy load. Fixed in System ROM 3.00.",
    resolvesErrorCodes: ["0032|0462", "0005|0003"],
    severity: "critical",
  },
  {
    id: "a00134353en_us",
    component: "System ROM",
    platforms: ["Gen11"],
    affected: { min: "1.32", max: "1.40" },
    fixedIn: "1.42",
    title: "Red Screen of Death during boot (AMD Gen11)",
    description:
      "Intermittent Red Screen of Death during boot (x64 Page-Fault Exception). Fixed in System ROM 1.42.",
    resolvesErrorCodes: [],
    severity: "critical",
  },

  // ================= iLO =================
  {
    id: "a00141858en_us",
    component: "iLO (Lights-Out Management)",
    platforms: ["Gen10", "Gen11"],
    affected: { min: "3.05", max: "3.05" },
    fixedIn: "3.06",
    title: "'Reset iLO' may cause unplanned server outage",
    description:
      "On iLO 5 v3.05 / iLO 6 v1.60, resetting iLO while the server is powered on may cause an unplanned server outage. Fixed in iLO 5 v3.06 / iLO 6 v1.61.",
    resolvesErrorCodes: ["0005|0003"],
    severity: "critical",
  },
  {
    id: "a00056013en_us",
    component: "iLO (Lights-Out Management)",
    platforms: ["Gen10"],
    affected: { max: "1.30" },
    fixedIn: "1.35",
    title: "False Smart Array error messages after firmware update",
    description:
      "iLO 5 1.30 or earlier logs false Smart Array cache/backup-power error messages after a controller firmware update. Fixed in iLO 5 1.35.",
    resolvesErrorCodes: [],
    severity: "warning",
  },
  {
    id: "a00136681en_us",
    component: "iLO (Lights-Out Management)",
    platforms: ["Gen10", "Gen10 Plus"],
    affected: { min: "2.96", max: "2.97" },
    fixedIn: "2.98",
    title: "Redfish events no longer posted to monitoring",
    description:
      "After upgrading to iLO 5 2.96/2.97, iLO may stop posting Redfish events to HPE OneView / Compute Ops Management.",
    resolvesErrorCodes: [],
    severity: "warning",
  },

  // ================= Storage controllers =================
  {
    id: "a00097210en_us",
    component: "Storage controller",
    platforms: ["Gen10"],
    affected: { min: "1.98", max: "2.62" },
    fixedIn: "2.65",
    title: "Potential data inconsistency on Smart Array SR Gen10",
    description:
      "Potential data inconsistency after an Unrecoverable Read Error on RAID 1/10/ADM (FW 2.62) or during initial RAID 5/6/50/60 config (FW 1.98-2.03). Update immediately.",
    resolvesErrorCodes: [],
    severity: "critical",
  },

  // ================= Innovation Engine (IE) =================
  {
    id: "a00121346en_us",
    component: "Intel Innovation Engine (IE)",
    platforms: ["Gen10"],
    affected: { max: "0.2.2.3" },
    fixedIn: "0.2.3.0",
    title: "Brief CPU or network traffic loss every 24 hours (IE FW)",
    description:
      "Approximately every 24 hours, the server may experience a brief loss of CPU utilization and a drop in network traffic for ~50 ms, which can result in dropped network clients. Affects Gen10 servers with Intel Xeon Scalable processors running Innovation Engine (IE) FW revision 0.2.2.2 or 0.2.2.3 (and older 0.2.x revisions).",
    resolvesErrorCodes: [],
    severity: "warning",
  },

  // ================= Power Management Controller =================
  {
    id: "a00118715en_us",
    component: "Power Management Controller (PMC)",
    platforms: ["Gen10", "Gen10 Plus"],
    affected: { min: "1.0.7", max: "1.0.7" },
    fixedIn: "1.0.8",
    title: "PMC firmware 1.0.7 update failure with OneView",
    description:
      "Power Management Controller firmware 1.0.7 fails to update when OneView 5.60 or earlier is used to apply SPP in Firmware Only mode.",
    resolvesErrorCodes: [],
    severity: "warning",
  },

  // ================= Network adapters =================
  {
    id: "a00097283en_us",
    component: "Network",
    platforms: ["Gen10"],
    affected: { min: "7.18.26", max: "7.18.26" },
    fixedIn: "7.18.27",
    title: "False overheat / shutdown on 536FLR-T firmware 7.18.26",
    description:
      "Firmware combo image 7.18.26 lowered temperature thresholds, causing increased fan speed, false overheat reports, and possible unexpected shutdowns.",
    resolvesErrorCodes: [],
    severity: "warning",
  },
];
