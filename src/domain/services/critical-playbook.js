// @ts-check
// Critical-event playbooks ("what to do").
//
// For EVERY critical IML/IEL event the RCA use case attaches a structured
// playbook: what the error means (field-level interpretation of the message),
// decoded details extracted from the message when possible (error status
// bits, bus/device/function, component numbers, readings), and an ordered
// list of concrete troubleshooting steps. This supplements the official HPE
// cause/resolution text with a "read the message, then act" explanation.
//
// Selection order:
//   1. Category from the official HPE catalog (IML_EVENTS `category`),
//      which covers every catalogued critical code.
//   2. Keyword detection on the message (for codes not in the catalog).
//   3. A generic structured fallback so no critical event is left without
//      guidance.

/** @typedef {import("../entities/model.js").Playbook} Playbook */

// ---------------------------------------------------------------------------
// PCIe
// ---------------------------------------------------------------------------

/** Decode a PCIe Uncorrectable Error Status register value. */
const PCIE_STATUS_BITS = [
  [0, "Undefined"],
  [2, "Header Log Overflow"],
  [4, "Data Link Protocol Error (malformed link traffic)"],
  [5, "Surprise Link Down (link dropped without warning)"],
  [6, "Poisoned TLP (corrupted data propagated)"],
  [7, "Flow Control Protocol Error"],
  [8, "Internal Error (device hardware failure)"],
  [9, "Receiver Buffer Overflow"],
  [12, "Max Retry Number Exceeded (link never acknowledged packets)"],
  [13, "ECRC Validation Failure (checksum error on packets)"],
  [14, "Uncorrectable Non-Fatal Error"],
  [15, "Uncorrectable Fatal Error"],
  [20, "Completion Timeout (device never answered a request)"],
  [21, "Completer Abort (device rejected the request)"],
  [22, "Unexpected Completion (unsolicited completion)"],
  [23, "Receiver Overflow"],
];

/**
 * @param {string} text
 * @returns {Playbook}
 */
function pciePlaybook(text) {
  const domain = /Segment\s+0x([0-9a-fA-F]+)/.exec(text)?.[1];
  const bus = /Bus\s+0x([0-9a-fA-F]+)/.exec(text)?.[1];
  const device = /Device\s+0x([0-9a-fA-F]+)/.exec(text)?.[1];
  const fn = /Function\s+0x([0-9a-fA-F]+)/.exec(text)?.[1];
  const statusHex = /Error\s+Status:?\s*0x([0-9a-fA-F]+)/i.exec(text)?.[1];

  const details = [];
  if (bus && device && fn) {
    details.push({
      label: "Failing endpoint (Segment:Bus:Device.Function)",
      value:
        `Segment ${domain ? "0x" + domain : "0x0"}, Bus 0x${bus}, ` +
        `Device 0x${device}, Function 0x${fn}`,
    });
  }
  if (statusHex) {
    const val = parseInt(statusHex, 16);
    const bits = PCIE_STATUS_BITS.filter(([bit]) => (val & (1 << Number(bit))) !== 0).map(
      ([bit, name]) => `bit ${bit}: ${name}`
    );
    details.push({
      label: "Uncorrectable Error Status",
      value: `0x${statusHex}${bits.length ? " — " + bits.join("; ") : ""}`,
    });
  }

  const meaning =
    "An unrecoverable PCI Express error was detected on the PCIe bus or on a device attached to it " +
    "(storage controller, network adapter, riser, accelerator/GPU, or the chipset itself). " +
    '"Uncorrectable" means the hardware could not recover on its own, so data or packets in flight during the error window may be lost. ' +
    "Typical root causes: the card is physically failing, it is badly seated, its riser/board slot is faulty, " +
    "its firmware/driver is buggy, or (frequently) a known firmware bug floods these errors. " +
    "On the OS side this usually surfaces as a machine check, crash or reboot.";

  const steps = [
    "Identify the PCI Bus:Device:Function from the message and map it to a physical slot using the iLO PCIe device table (iLO > Information > PCIe Devices) or the slot power/location LED.",
    "Check whether the same Bus:Device.Function repeats across this RCA entry and the OS logs; a single recurring endpoint usually means that card or its riser is failing.",
    "Power the server off and reseat the affected card; inspect for bent pins, cracked risers and dust. If possible, move the card to another slot or swap it with a twin to isolate card vs slot.",
    "Update to the latest firmware: system ROM, riser firmware, and the driver/firmware of the failing card (see the advisory blocks below — some platforms had known false/root-caused PCIe error floods).",
    "Check iLO ErrorCode Statistics and the correlation between repeated entries and specific workload/vibration to rule out marginal seating.",
    "If the decoded status shows Internal Error (bit 8), Completion Timeout or the error recurs after reseating and firmware updates, replace the failing card first, then the riser.",
    "After any replacement, clear the IML and confirm the error does not return under the same workload.",
  ];

  return { meaning, details: details.length ? details : undefined, steps };
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Playbook} */
function processorPlaybook(text) {
  const procs = [...(text.match(/\b Processor\s+\d+|\bCPU\s+\d+/gi) ?? [])];
  const isFatal = /fatal|uncorrectable|machine check|failure/i.test(text);
  return {
    meaning:
      "A processor-level unrecoverable fault was detected" +
      (isFatal ? " (machine check exception, ROM BIST failure or processor marked as failed)." : ".") +
      " The CPU itself may be damaged, or an out-of-spec condition triggered it: unstable power rails, overheating, bad socket contact or a known system ROM bug producing false machine check errors.",
    details: procs.length
      ? [{ label: "Affected unit(s)", value: [...new Set(procs)].join(", ") }]
      : undefined,
    steps: [
      "Note the processor number/function decoded from the message and correlate with any memory, temperature or power events at the same timestamp.",
      "Update the system ROM to the latest revision before concluding the CPU is failing — several releases fixed false machine check / processor degraded events (compare the firmware advisories below).",
      "Run the Lifecycle Controller / OFFLINE diagnostics CPU test to confirm whether the failure is reproducible.",
      "Power down, reseat the processor and heatsink with fresh thermal compound; inspect the socket for bent, burnt or discolored pins.",
      "Verify power delivery: PSUs healthy, all FS cables/mounting correct, and the dimm/fan tables consistent with the ROM (outdated fan or power tables cause overheat/power-glitch MCEs).",
      "If the event recurs on the same processor after ROM update and reseat, open an HPE support case and replace the processor.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Playbook} */
function memoryPlaybook(text) {
  const dimms = [...(text.match(/\bDIMM\s+\d+/g) ?? [])];
  return {
    meaning:
      "The memory subsystem reported an unrecoverable error (or a correctable-error flood that crossed its tolerance threshold). " +
      "The DIMM named in the message is the usual suspect, but the real source can also be the memory channel or the CPU memory controller feeding it.",
    details: dimms.length
      ? [{ label: "Modules flagged", value: [...new Set(dimms)].join(", ") }]
      : undefined,
    steps: [
      "Locate the flagged DIMM physically (iLO Health > Memory shows the slot map) and schedule downtime to service it.",
      "Download the system ROM updates: several HPE platforms had advisories producing false or exaggerated uncorrectable memory errors (check the advisory blocks below).",
      "Power down and reseat the DIMM; clean the connector contacts; verify it matches the platform population/redundancy rules (Gen10/Gen11/Gen12 rules differ).",
      "Run the HPE OFFLINE memory diagnostics focused on the flagged module to confirm or clear it.",
      "If errors persist on the same DIMM, replace it with a validated HPE module and confirm the error clears.",
      "If the error moves to the neighbouring DIMM/rank or different DIMMs repeatedly, suspect the memory channel/CPU or the system board instead, and open an HPE support case.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Thermal
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Playbook} */
function temperaturePlaybook(text) {
  const temp = /(-?\d+(?:\.\d+)?)\s*(?:°\s*)?C\b/.exec(text)?.[1];
  return {
    meaning:
      "A temperature exceeded its critical threshold" + (temp ? ` — reported reading ${temp}°C.` : ".") +
      " The server throttles workloads or powers down to protect the hardware. Causes are usually cooling (fans failing, blocked airflow, missing blanking panels, hot room) rather than the sensor itself.",
    steps: [
      "Confirm the fans are all reporting healthy speeds (iLO Health > Fans) — a failed fan often causes the temperature rise.",
      "Check room ambient temperature and airflow: fit blanking panels wherever drives/computing modules are missing and verify no cables block the airflow.",
      "Verify ambient conditions and airflow: fit blanking panels wherever modules are missing and confirm no cables block the airflow path.",
      "Verify the fan table matches the installed hardware and ROM revision (an outdated fan table overcools mistakes the thermal profile); update the system ROM/firmware if needed.",
      "Verify the workload: thermal spikes under heavy load may require load-shedding, better rack positioning or dedicated airflow.",
      "If the error persists at idle with good airflow and healthy fans, the sensor/zone is suspect — open an HPE support case and do not keep running the server in this state.",
    ],
  };
}

/** @param {string} _text @returns {Playbook} */
function coolingPlaybook(_text) {
  return {
    meaning:
      "A cooling fan failed or cooling redundancy was lost. The remaining fans usually spin faster, but the subsystem has no margin for another failure and a subsequent failure can overheat the server.",
    steps: [
      "Locate the failed fan (iLO Health > Fans shows the fan map; the message names the fan number).",
      "Power off and reseat the fan; clean any obstruction from its intake and exhaust path.",
      "Check the fan and its cable for damage; confirm the fan connector on the fan board/chassis is clean.",
      "Verify all empty drive bays have blanks fitted and no external hardware is blocking the airflow.",
      "If the fan does not recover, replace it — meanwhile the remaining fans are a​​ single point of failure for cooling.",
      "If several fans fail simultaneously or the replacements keep failing on the same slot, suspect the fan board or power delivery, not the fans.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Playbook} */
function powerPlaybook(text) {
  const psu = [...(text.match(/\bPower Supply\s+\d+|\bPSU\s+\d+|\bbay\s+\d+\b/gi) ?? [])];
  return {
    meaning:
      "A power subsystem event was detected: a power supply unit failed, lost AC input, was removed, or the power limit/redundancy envelope was breached. Power redundancy (if configured) is lost; the server keeps running on the remaining PSU.",
    details: psu.length ? [{ label: "Flagged unit(s)", value: [...new Set(psu)].join(", ") }] : undefined,
    steps: [
      "Identify the PSU/bay number in the message and check whether the unit is actually plugged in, using the LED status on the PSU faceplate.",
      "Remove the PSU, reinsert it firmly, and confirm the AC feed/PDU circuit is delivering power.",
      "Verify the feed capacity: PSU wattage rating, per-circuit amps, and total system power envelope vs the configured power cap.",
      "Check iLO Health > Power: total output and PSU firmware revision. Update PSU and system firmware — outdated PSU firmware is a known cause of false errors.",
      "If the PSU does not recover, replace it; restore redundancy by fitting a second PSU if only one was installed.",
      "If PSUs keep failing across different units, suspect the site power (PDU, circuit) or the PSU mains switch component and open an HPE support case.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Playbook} */
function storagePlaybook(text) {
  const locations = [
    ...new Set(
      [
        ...(text.match(/\bSlot\s+\d+/g) ?? []),
        ...(text.match(/Port\s+:?\s*[0-9a-f]+[a-zA-Z]\s*Box\s+\d+/g) ?? []),
        ...(text.match(/\bDrive\s+\d+/g) ?? []),
      ].filter(Boolean)
    ),
  ];
  const isDrive = /\b(drive\b|hard\s*drive)/i.test(text);
  const isCache = /(cache module|battery|supercap)/i.test(text);
  const isController = /(controller|smart array|raid)/i.test(text) && !isDrive && !isCache;
  const which = isDrive
    ? "a physical drive failed or was flagged"
    : isCache
      ? "the cache module / battery (supercap) failed or degraded"
      : isController
        ? "the storage controller failed or is unhealthy"
        : "a storage component was flagged";

  return {
    meaning:
      "A storage subsystem fault was detected: " + which + ". " +
      "Depending on the component, the array can degrade to no-redundancy, run without write-cache protection, or become offline. Data impact ranges from performance loss to potential data loss.",
    details: locations.length
      ? [{ label: "Controller/drive location", value: locations.join(", ") }]
      : undefined,
    steps: [
      "Verify the exact scope: iLO > System Storage and the Smart Array event log show which entity is Offline, Failed or Failing.",
      "Drive failure: hot-swap replace the drive with an identical/validated one, let the array rebuild, and verify the rebuild completes without a second failure (during rebuild redundancy is low).",
      "Cache/battery module failure: the controller degrades to write-cache-off; replace the cache module/battery to restore full protection and performance.",
      "Controller failure: back up remaining data, gather support files, and replace the controller (or update its firmware first if the advisory list below shows a matching known bug).",
      "Update the Smart Array controller and drive firmware to the latest SPP — stale firmware is the most common cause of drives dropping out.",
      "After replacement, confirm the array is back to full redundancy/write-cache protection and clear the IML to verify the error does not repeat.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Playbook} */
function networkPlaybook(text) {
  const ports = [...(text.match(/\bPort\s+\d+\b/g) ?? [])];
  return {
    meaning:
      "A network adapter / NIC controller was flagged (failed POST, degraded state, dropped link, or unrecoverable error on the device). " +
      "Connectivity may be degraded or lost depending on the affected port; if the adapter is part of a redundant team, traffic keeps flowing on the surviving port while you recover this one.",
    details: ports.length ? [{ label: "Affected port(s)", value: [...new Set(ports)].join(", ") }] : undefined,
    steps: [
      "Check iLO Health > Network to confirm which adapter/port is degraded or failed.",
      "Update the NIC driver AND firmware — network adapters are the subsystem most fixed by firmware updates.",
      "Power off and reseat the adapter (and any riser); if available, swap port-to-port to isolate card vs board.",
      "Verify no known firmware advisory applies (see the advisory blocks below).",
      "If the port/adapter does not recover after firmware and reseat, replace the adapter (or onboard adapter = system board) through HPE support.",
    ],
  };
}

// ---------------------------------------------------------------------------
// System board / enclosure / battery
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Playbook} */
function systemPlaybook(text) {
  const isBattery = /(battery|cmos|supercap)/i.test(text);
  const isWatchdog = /watchdog|wdt/i.test(text);
  let meaning =
    "A system board level fault was detected, or the server could not complete a critical boot step. " +
    "This is the class of error that stops POST, prevents power-on, or degrades system board functionality.";
  if (isBattery) {
    meaning =
      "The CMOS battery/supercap that keeps board clocks and configuration was removed, failed or degraded. " +
      "Without it, the server may lose date/time, boot records and configuration when AC power is removed.";
  } else if (isWatchdog) {
    meaning =
      "A hardware/system watchdog expired: a subsystem failed to report activity in time, so the watchdog fired. " +
      "This typically means a pending hardware/firmware issue (stuck boot, driver hang, board fault) rather than a single component failure.";
  }
  return {
    meaning,
    steps: [
      "Read the exact title and compare with the historical IML entries after this one — a single one-shot error often goes away after a clean power-cycle.",
      "Update the system ROM, CPLD and the implicated firmware to the latest revision (many board/POST errors are firmware issues).",
      isBattery
        ? "Replace the CMOS battery/supercap and reconfigure date/time, then confirm it persists across AC removal."
        : "Power-off (hold the TOC/power button for complete shutdown), disconnect AC, wait 30 s, reconnect and re-boot.",
      isWatchdog ? "Check the OS logs/driver version that hung and update the implicated driver." : "",
      "Run the OFFLINE diagnostics (Lifecycle Controller) covering board and connected devices.",
      "If the same board-level error recurs after the firmware updates and clean power-cycle, escalate to HPE support for board repair/replacement.",
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/** @param {string} _text @returns {Playbook} */
function securityPlaybook(_text) {
  return {
    meaning:
      "The security state of the system (iLO security stack, TPM/platform certificate, UEFI secure boot, or account/silo integrity) is degraded or at risk. " +
      "This is a compliance/reliability concern and may block features keyed to a healthy security state (silicon root of trust, secure boot).",
    steps: [
      "Open the iLO Security Dashboard (iLO > Main menu > Security) to see the exact degraded aspect behind this event.",
      "Check for related events in the same time window (a TPM/secure boot event usually follows an intentional configuration change).",
      "Verify the operations that were being performed (certificates, secure keys, ROM update) and complete or redo them properly.",
      "Update firmware: many security-state errors are cleared by firmware fixes that re-seal the platform state.",
      "If you did NOT authorize these security-affecting operations, treat it as a potential security incident: audit who changed settings (iLO logs), rotate credentials, and inform your security team.",
      "Engage HPE support with the Security Dashboard report if the state stays degraded.",
    ],
  };
}

// ---------------------------------------------------------------------------
// iLO / firmware
// ---------------------------------------------------------------------------

/** @param {string} _text @returns {Playbook} */
function iloPlaybook(_text) {
  return {
    meaning:
      "The iLO management processor itself failed/recovered or its firmware entered an unrecoverable state. " +
      "The server may keep running, but you lose out-of-band management until iLO is restored; logging and alerting from this event onwards are unreliable.",
    steps: [
      "Verify iLO state remotely (ping, web UI, SSH); if reachable but degraded, back up the iLO configuration first.",
      "Perform an iLO reset (RIP): web UI > main menu > Diagnostics > Reset; after reset re-check version/health.",
      "Update the iLO firmware to the latest release (iLO self-update or Offline update with the SPP).",
      "If iLO is unreachable and the server is up, schedule a maintenance window to perform a cold boot (AC disconnect) which hard-resets the iLO.",
      "If iLO keeps failing after firmware update and cold boot, escalate to HPE support: the iLO chip/firmware flash on the board may need replacement.",
    ],
  };
}

/** @param {string} text @returns {Playbook} */
function firmwarePlaybook(text) {
  const comps = [...new Set([...(text.match(/\b(system ROM|CPLD|ME\b|iLO|BIOS|SAS drive|programmable logic)/i)?.slice(1) ?? [])].filter(Boolean))];
  return {
    meaning:
      "A firmware update/verification failed on one of the managed components" +
      (comps.length ? " (" + comps.join(", ") + ")." : " (system ROM, CPLD, iLO, controller...).") +
      " The component may be running on a preserved/previous image; future updates or security features (secure boot, silicon root of trust) can be blocked until the flash is completed or the component is replaced.",
    steps: [
      "Identify the component and whether the update was applied by iLO Service Pack/Smart Update or manually.",
      "Re-run the firmware update with the latest SPP; do not skip verification errors — never force a partial flash.",
      "Check the component firmware revision (iLO Health / main menu firmware inventory) and confirm whether it is running the previous (preserved) image.",
      "Check the advisory blocks below for known bad firmware releases for your platform.",
      "If the flash fails repeatedly on the same component, escalate to HPE support: reflashing via the external tools or a board component repair may be required.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Selection logic
// ---------------------------------------------------------------------------

/**
 * @param {string} alarm
 * @param {string} title
 * @param {string|null} category
 * @returns {Playbook}
 */
export function buildPlaybook(alarm, title, category = null) {
  const text = `${title} ${alarm}`;

  // 1) Official HPE catalog category — the primary selector.
  switch (category) {
    case "pcie":
      return pciePlaybook(text);
    case "memory":
      return memoryPlaybook(text);
    case "processor":
      return processorPlaybook(text);
    case "cooling":
      return temperaturePlaybook(text);
    case "power":
      return powerPlaybook(text);
    case "storage":
      return storagePlaybook(text);
    case "network":
      return networkPlaybook(text);
    case "security":
      return securityPlaybook(text);
    case "ilo":
      return iloPlaybook(text);
    case "firmware":
      return firmwarePlaybook(text);
    case "system":
      return systemPlaybook(text);
  }

  // 2) Keyword detection for events outside the official catalog.
  if (/pci\s?express|pcie/i.test(text)) return pciePlaybook(text);
  if (/machine check|\bbist\b|processor.*(failure|fail(ed)?|unrecoverable)/i.test(text)) {
    return processorPlaybook(text);
  }
  if (/\bdimm\b|memory\s*(error|failure|unsafe|uncorrectable|rank)/i.test(text)) {
    return memoryPlaybook(text);
  }
  if (/temperature|thermal|overheat/i.test(text)) return temperaturePlaybook(text);
  if (/\bfan\b/i.test(text)) return coolingPlaybook(text);
  if (/power supply|power cord|ac cord|ac\s*power/i.test(text)) return powerPlaybook(text);
  if (/smart array|drive|storage|logical drive|cache module|battery.*array/i.test(text)) {
    return storagePlaybook(text);
  }
  if (/network|nic\b|adapter.*(fail|error)|port.*(fail|link)/i.test(text)) return networkPlaybook(text);
  if (/security|secure boot|tpm|certificate/i.test(text)) return securityPlaybook(text);
  if (/ilo\b/i.test(text)) return iloPlaybook(text);
  if (/(firmware|programmable logic)/i.test(text)) return firmwarePlaybook(text);

  // 3) Structured fallback — no critical event is left without guidance.
  return genericPlaybook(text);
}

/** @param {string} text */
function genericPlaybook(text) {
  const isFatal = /fatal|uncorrectable|could not/i.test(text);
  return {
    meaning: isFatal
      ? "A critical event was logged: the subsystem could not recover and the event may have crashed or degraded the server. " +
        "This specific message is not in the HPE troubleshooting catalog this analyzer follows, so interpret it against the official HPE resolution text shown below and the message itself."
      : "A critical event was logged indicating a failure condition in one of the monitored subsystems. " +
        "This specific message is not in the HPE troubleshooting catalog this analyzer follows, so interpret it against the official HPE resolution text shown below.",
    steps: [
      "Read the full message above and the official HPE resolution below — for uncatalogued events that text is the primary guidance.",
      "Open the official HPE documentation link below and match the message wording against the guide entry for your platform generation.",
      "Check correlated events at the same timestamp in the IML/OS log to confirm the failing component.",
      "Update the system ROM and implicated subsystem firmware to the latest release, then re-test under the conditions that produced the error.",
      "If the event recurs after the update, open an HPE Support case with this analysis report attached.",
    ],
  };
}
