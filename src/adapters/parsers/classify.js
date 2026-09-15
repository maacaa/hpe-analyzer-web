// Classification layer: map parsed records into a universal typed model.
//
// Every value keeps a `source` (which record it came from) so nothing is
// silently dropped.

/**
 * Build a tag -> node index over an XML subtree in a single pre-order pass.
 * Mirrors the lookup semantics of a recursive `find(node, tag)` (a node's own
 * keys are checked before descending into its children), but each tag is then
 * resolved in O(1) instead of rescanning the whole tree per lookup.
 */
function indexTags(tree) {
  const index = new Map();
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (!index.has(key)) index.set(key, value);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(tree);
  return index;
}

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Attribute id (fast-xml-parser stores attributes as "@_id"). */
function attr(node, name) {
  if (!node || typeof node !== "object") return undefined;
  return node[`@_${name}`] ?? node[name];
}

/**
 * bcert.pkg (MfgRecord) -> { firmware, hardware, meta }
 * The XML holds the factory "as-built" hardware/firmware inventory.
 */
export function classifyBcert(bcertTree) {
  const treeIdx = indexTags(bcertTree);
  const mfg = treeIdx.get("MfgRecord") || {};
  const firmware = [];
  const hardware = [];
  const meta = {};

  if (mfg && Object.keys(mfg).length > 0) {
    classifyMfgRecord(mfg, firmware, hardware, meta, treeIdx);
  } else {
    const fbt = treeIdx.get("FBTRecord");
    if (fbt) classifyFbtRecord(fbt, firmware, hardware, meta);
  }

  return { firmware, hardware, meta, raw: bcertTree };
}

function classifyMfgRecord(mfg, firmware, hardware, meta, treeIdx) {
  const find = (tag) => treeIdx.get(tag);
  const lockdown = find("FirmwareLockdown") || {};
  if (lockdown && typeof lockdown === "object") {
    for (const [k, v] of Object.entries(lockdown)) {
      if (typeof v === "string" || typeof v === "number") {
        firmware.push({ component: k, version: String(v), source: "bcert.pkg (FirmwareLockdown)" });
      }
    }
  }

  const bios = find("BIOS");
  if (bios?.Version) {
    firmware.push({
      component: "System ROM",
      version: bios.ReleaseDate ? `v${bios.Version} (${bios.ReleaseDate})` : bios.Version,
      source: "bcert.pkg (BIOS)",
    });
  }

  const cpld = find("CPLD");
  if (cpld?.Version) {
    firmware.push({ component: "SystemProgrammableLogicDevice", version: cpld.Version, source: "bcert.pkg (CPLD)" });
  }

  const rom = find("ROM");
  if (rom?.RedundantROMDate) {
    firmware.push({ component: "Redundant System ROM", version: rom.RedundantROMDate, source: "bcert.pkg (ROM)" });
  }

  const bmc = find("BMC");
  if (bmc?.Version) {
    firmware.push({ component: "BMC", version: bmc.Version, source: "bcert.pkg (BMC)" });
  }

  for (const cpu of asArray(find("CPU"))) {
    hardware.push({
      type: "cpu",
      id: attr(cpu, "id"),
      manufacturer: cpu?.Manufacturer,
      model: cpu?.Processor,
      family: cpu?.Family,
      speed: cpu?.Speed,
      cores: cpu?.Cores,
      cache: [cpu?.L1Cache, cpu?.L2Cache, cpu?.L3Cache].filter(Boolean).join(" / "),
      stepping: cpu?.Stepping,
      source: "bcert.pkg (CPU)",
    });
  }

  for (const mem of asArray(find("Memory"))) {
    hardware.push({
      type: "memory",
      id: attr(mem, "id"),
      manufacturer: mem?.Manufacturer,
      model: mem?.Model,
      partNumber: mem?.PartNumber,
      serialNumber: mem?.SerialNumber,
      memoryType: mem?.MemoryType,
      moduleType: mem?.MemoryModuleType,
      speed: mem?.MemoryModuleSpeed,
      size: mem?.MemorySize,
      slot: mem?.Slot,
      correctable: mem?.CorrectableErrors,
      uncorrectable: mem?.UncorrectableErrors,
      source: "bcert.pkg (Memory)",
    });
  }

  for (const nc of asArray(find("NetworkController"))) {
    hardware.push({
      type: "network-controller",
      id: attr(nc, "id"),
      manufacturer: nc?.Manufacturer,
      model: nc?.Model,
      interface: nc?.Interface,
      macAddress: nc?.MACAddress,
      adapterType: nc?.AdapterType,
      firmware: nc?.FirmwareVersion,
      slot: nc?.Slot,
      source: "bcert.pkg (NetworkController)",
    });
  }

  for (const vc of asArray(find("VideoController"))) {
    hardware.push({
      type: "video-controller",
      id: attr(vc, "id"),
      manufacturer: vc?.Manufacturer,
      model: vc?.Model,
      source: "bcert.pkg (VideoController)",
    });
  }

  for (const fan of asArray(find("FanSlot"))) {
    hardware.push({
      type: "fan",
      id: attr(fan, "id"),
      slot: attr(fan, "id") !== undefined ? `Fan ${attr(fan, "id")}` : undefined,
      present: fan?.Present,
      redundant: fan?.Redundant,
      source: "bcert.pkg (FanSlot)",
    });
  }

  for (const psu of asArray(find("PowerSupplySlot"))) {
    hardware.push({
      type: "power-supply",
      id: attr(psu, "id"),
      slot: attr(psu, "id") !== undefined ? `Power Supply ${attr(psu, "id")}` : undefined,
      serialNumber: psu?.SerialNumber,
      firmware: psu?.FirmwareVersion,
      sparePartNumber: psu?.SparePartNumber,
      present: psu?.Present,
      source: "bcert.pkg (PowerSupplySlot)",
    });
  }

  for (const ctrl of asArray(find("StorageController"))) {
    hardware.push({
      type: "storage-controller",
      model: ctrl?.Model,
      slot: ctrl?.Slot,
      memorySize: ctrl?.MemorySize,
      connectedDrives: ctrl?.ConnectedDrives,
      firmware: ctrl?.FirmwareVersion,
      source: "bcert.pkg (StorageController)",
    });
  }

  for (const drive of asArray(find("HardDrive"))) {
    hardware.push({
      type: "hard-drive",
      id: attr(drive, "id"),
      model: drive?.Model,
      serialNumber: drive?.SerialNumber,
      controllerType: drive?.ControllerType,
      driveType: drive?.DriveType,
      capacity: drive?.Capacity,
      firmware: drive?.FirmwareVersion,
      source: "bcert.pkg (HardDrive)",
    });
  }

  const diag = find("DiagProcess") || {};
  if (diag) {
    meta.serialNumber = diag.SerialNumber;
    meta.productName = diag.ProductName;
    meta.productId = diag.ProductId;
    meta.orderNumber = diag.OrderNumber;
  }

  const productId = find("ProductIdentification") || {};
  if (productId && typeof productId === "object") {
    meta.manufacturer = productId.Manufacturer;
    meta.skuNumber = productId.SkuNumber;
    meta.assetTag = productId.AssetTag;
    meta.universalUniqueId = productId.UniversalUniqueID;
  }

  const bom = find("BuildOfMaterials") || {};
  if (bom?.ctohw) {
    meta.buildOfMaterials = bom.ctohw;
  }
  const tsm = find("TotalSystemMemory");
  if (tsm) meta.totalSystemMemory = tsm;
}

function classifyFbtRecord(fbt, firmware, hardware, meta) {
  const general = fbt.General || {};
  if (general.BoardName) meta.productName = general.BoardName;
  // PCASerialNumber is the fabrication serial of the mainboard PCB, NOT the
  // unit serial (reported in Subtitle as meta.pcaSerialNumber). The unit
  // serial arrives from DiagProcess when present, otherwise from the zbb
  // system-identity block (see zbb-stream.js).
  if (general.PCASerialNumber) meta.pcaSerialNumber = general.PCASerialNumber;
  if (general.PCAPartNumber) meta.pcaPartNumber = general.PCAPartNumber;
  if (general.PCAManufacturer) meta.manufacturer = general.PCAManufacturer;

  for (const item of asArray(fbt.Programmable)) {
    if (item?.Name && item?.Version) {
      firmware.push({
        component: item.Name,
        version: item.Version,
        source: "bcert.pkg (Programmable)",
      });
    }
  }

  let cpuIdx = 0;
  let memIdx = 0;
  let nicIdx = 0;
  let psuIdx = 0;

  for (const item of asArray(fbt.TestCommodities)) {
    const name = item?.Name || "";
    const pn = item?.PartNumber || "";
    const serial = item?.SerialNumber;
    const fw = item?.FirmwareVersion;
    const inst = attr(item, "instance");

    if (/cpu/i.test(name) && !/dummy/i.test(name)) {
      hardware.push({
        type: "cpu",
        id: String(++cpuIdx),
        model: name,
        partNumber: pn !== "N/A" ? pn : undefined,
        source: "bcert.pkg (TestCommodities)",
      });
    } else if (/dimm|memory/i.test(name) && pn !== "EMPTY" && !/dummy/i.test(name)) {
      hardware.push({
        type: "memory",
        id: String(++memIdx),
        model: name,
        partNumber: pn !== "N/A" ? pn : undefined,
        serialNumber: serial !== "EMPTY" ? serial : undefined,
        source: "bcert.pkg (TestCommodities)",
      });
    } else if (/adapter|nic|flexfabric|ethernet|network/i.test(name)) {
      hardware.push({
        type: "network-controller",
        id: String(++nicIdx),
        model: name,
        partNumber: pn !== "N/A" ? pn : undefined,
        serialNumber: serial,
        firmware: fw,
        source: "bcert.pkg (TestCommodities)",
      });
    } else if (/power\s*supply/i.test(name)) {
      hardware.push({
        type: "power-supply",
        id: inst || String(++psuIdx),
        slot: inst ? `Power Supply ${inst}` : undefined,
        model: name,
        firmware: fw,
        source: "bcert.pkg (TestCommodities)",
      });
    } else if (/storage|controller|aroc|smart|raid/i.test(name)) {
      hardware.push({
        type: "storage-controller",
        model: name,
        partNumber: pn !== "N/A" ? pn : undefined,
        source: "bcert.pkg (TestCommodities)",
      });
    } else if (/backplane/i.test(name)) {
      hardware.push({
        type: "storage-controller",
        model: name,
        partNumber: pn !== "N/A" ? pn : undefined,
        source: "bcert.pkg (TestCommodities)",
      });
    } else if (/tpm/i.test(name)) {
      hardware.push({
        type: "system-board",
        model: name,
        partNumber: pn !== "N/A" ? pn : undefined,
        source: "bcert.pkg (TestCommodities)",
      });
    }
  }
}
