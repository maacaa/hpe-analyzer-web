// ZBB scan sink: applies scanned log entries / inline records / firmware
// versions to the analysis model. Shared by the whole-buffer path
// (record-dispatch.js) and the streaming path (analyzer-stream.js) so both
// produce identical models.

import { splitAction, parseLogDate } from "../../domain/services/iml-format.js";
import { createZbbScanner } from "./zbb-stream.js";
import { FW_NAME_VALUE } from "./zbb.js";

// PCI device-table rows repeat in every zbb snapshot (and across records):
// dedupe per model by identity (first occurrence kept, later rows ignored).
const PCI_SEEN = new WeakMap();

// Plain-text echo entries duplicate the binary belt entries (the same event
// serialized twice) and may arrive before or after their belt copy: dedupe
// by class|event|date|alarm so an event is surfaced exactly once. Belt
// (non-echo) copies always win: their message carries the ACTION text.
const ENTRY_SEEN = new WeakMap();

/**
 * @param {import("../../domain/entities/model.js").Model} model
 * @returns {Map<string, Map<string, Record<string, unknown>>>}
 */
function entrySeenFor(model) {
  let seen = ENTRY_SEEN.get(model);
  if (!seen) {
    seen = new Map();
    ENTRY_SEEN.set(model, seen);
  }
  return seen;
}

/**
 * @param {import("../../domain/entities/model.js").Model} model
 * @returns {Set<string>}
 */
function pciSeenFor(model) {
  let seen = PCI_SEEN.get(model);
  if (!seen) {
    seen = new Set();
    PCI_SEEN.set(model, seen);
  }
  return seen;
}

/** Normalize a component name for identity comparison. */
function normComponent(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Find a previously catalogued hardware entry matching a scanned PCI row.
 * Machine data (MAC for NICs, model identity otherwise) drives the match so
 * the Hardware tab shows one card, once.
 */
function findMatchingHardware(model, norm, macNorm) {
  if (macNorm) {
    const byMac = model.hardware.find((h) => normComponent(h.macAddress) === macNorm);
    if (byMac) return byMac;
  }
  if (!norm) return null;
  return (
    model.hardware.find((h) => {
      const m = normComponent(h.model);
      return m && (m === norm || m.includes(norm) || norm.includes(m));
    }) ?? null
  );
}

/**
 * Merge/insert a scanned PCI card row into the model hardware list.
 * @param {import("../../domain/entities/model.js").Model} model
 * @param {Record<string, unknown>} entry HardwareEntry fields
 * @param {string} identity model string used for the merge key
 * @returns {boolean} true when a new entry was added
 */
function addPciCard(model, entry, identity) {
  const norm = normComponent(identity);
  const macNorm = entry.macAddress ? normComponent(entry.macAddress) : null;
  const existing = findMatchingHardware(model, norm, macNorm);
  if (existing) {
    // enrich the catalogued card with the scanned PCI data
    for (const [k, v] of Object.entries(entry)) {
      if (v !== undefined && v !== null && existing[k] === undefined) existing[k] = v;
    }
    return false;
  }
  if (model.hardware.length >= 512) return false; // hardware list stays bounded
  model.hardware.push(/** @type {never} */ (entry));
  return true;
}

/**
 * Build the sink that folds scanned zbb findings into the model.
 * @param {import("../../domain/entities/model.js").Model} model
 * @param {import("../../domain/ports/kb-port.js").KbPort} kb
 * @param {string} recName
 */
export function makeZbbSink(model, kb, recName) {
  const pciSeen = pciSeenFor(model);
  return {
    onEntry(e) {
      const severity = kb.resolveSeverity(e.classCode, e.eventCode, e.message);
      const { alarm, resolution } = splitAction(e.message);
      const ts = parseLogDate(e.date);
      const entry = {
        ...e,
        severity,
        alarm,
        resolution,
        timestamp: ts ? ts.getTime() : null,
        source: recName,
      };
      const seen = entrySeenFor(model);
      const groupKey = `${e.classCode}|${e.eventCode}|${e.date}`;
      let group = seen.get(groupKey);
      if (!group) {
        group = new Map();
        seen.set(groupKey, group);
      }
      const alarmKey = alarm.replace(/\s+/g, " ").trim();
      let stored = group.get(alarmKey);
      if (!stored && entry.echo) {
        // echo texts can carry trailing junk before the terminator (e.g. a
        // stray byte after "...possible."), so also match a belt copy whose
        // collapsed alarm differs only by a short tail.
        for (const [k, v] of group) {
          if (Math.abs(k.length - alarmKey.length) > 3) continue;
          const [shorter, longer] =
            k.length <= alarmKey.length ? [k, alarmKey] : [alarmKey, k];
          if (longer.startsWith(shorter)) {
            stored = v;
            break;
          }
        }
      }
      if (stored) {
        if (entry.echo) {
          // echo duplicate of an already-stored entry: backfill ACTION text
          if (!stored.resolution && resolution) stored.resolution = resolution;
          return;
        }
        if (stored.echo) {
          // the belt copy arrived after its echo: adopt the richer content
          stored.id = entry.id;
          stored.message = entry.message;
          stored.alarm = entry.alarm;
          stored.resolution = entry.resolution ?? stored.resolution;
          stored.timestamp = entry.timestamp;
          stored.echo = false;
          return;
        }
        // byte-identical belt repeat: keep both (real repeated events)
      }
      group.set(alarmKey, entry);
      // IML tab = the error log (type 0x0B); Event Logs tab = the iLO
      // Event Log / IEL (type 0x0C, e.g. sessions, firmware, resets).
      if (e.logType === "iel") model.events.push(entry);
      else model.iml.push(entry);
    },
    onInline(iv) {
      if (/version|firmware|rom/i.test(iv.name)) {
        model.firmware.push({
          component: iv.name,
          version: iv.value,
          source: `${recName} (${iv.name})`,
        });
      }
    },
    onSystemIdentity(identity) {
      // System identity tuple (present in every zbb snapshot). It only fills
      // values the bcert did not provide, so DiagProcess keeps priority and
      // the fabrication PCA serial never pollutes the unit serial again.
      const meta = model.meta;
      if (!meta.serialNumber && identity.serialNumber) {
        meta.serialNumber = identity.serialNumber;
      }
      if (!meta.productId && identity.partNumber) {
        meta.productId = identity.partNumber;
      }
    },
    onPciCard(card) {
      const key =
        `${card.manufacturer}|${card.name}|${card.vendorId}|${card.deviceId}`.toLowerCase();
      if (pciSeen.has(key)) return;
      pciSeen.add(key);
      addPciCard(
        model,
        {
          type: "pci-device",
          manufacturer: card.manufacturer,
          model: card.name,
          vendorId: card.vendorId,
          deviceId: card.deviceId,
          subsystemVendorId: card.subsystemVendorId,
          subsystemDeviceId: card.subsystemDeviceId,
          driverVersion: card.driverVersion,
          source: `${recName} (PCI device inventory)`,
        },
        card.name
      );
    },
    onPlatformSlot(row) {
      const key = `slot|${row.location}|${row.empty ? row.emptyLabel : `${row.manufacturer}|${row.model ?? ""}`}`.toLowerCase();
      if (pciSeen.has(key)) return;
      pciSeen.add(key);
      if (!row.empty && row.location.startsWith("OCP")) {
        // NIC rows are already catalogued from the bcert (NetworkController);
        // enrich the matched adapter and only push unmatched third-party cards.
        addPciCard(
          model,
          {
            type: "network-controller",
            slot: row.location,
            manufacturer: row.manufacturer,
            model: row.model ?? row.location,
            partNumber: row.partNumber,
            sparePartNumber: row.sparePartNumber,
            macAddress: row.macAddress,
            driverVersion: row.version,
            source: `${recName} (platform inventory)`,
          },
          row.model ?? row.location
        );
        return;
      }
      if (row.location.startsWith("PCI-E Slot")) {
        addPciCard(
          model,
          row.empty
            ? {
                type: "pci-device",
                slot: row.location,
                model: row.emptyLabel,
                source: `${recName} (platform inventory)`,
              }
            : {
                type: "pci-device",
                slot: row.location,
                manufacturer: row.manufacturer,
                model: row.model ?? row.emptyLabel,
                partNumber: row.partNumber,
                sparePartNumber: row.sparePartNumber,
                driverVersion: row.version,
                source: `${recName} (platform inventory)`,
              },
          row.model ?? row.emptyLabel ?? row.location
        );
      }
    },
    onFirmwareMatches(fwMatches, iloCandidates) {
      // Replicates extractFirmwareVersions output order: per-name matches in
      // FW_NAME_VALUE order (deduplicated by name+version), then the first
      // iLO version string found in document order.
      const out = [];
      for (const name of FW_NAME_VALUE) {
        for (const m of fwMatches) {
          if (m.name !== name) continue;
          if (!out.some((o) => o.name === name && o.version === m.version)) {
            out.push({ name, version: m.version });
          }
        }
      }
      if (iloCandidates.length > 0) {
        out.push({ name: "iLO", version: iloCandidates[0].version, date: iloCandidates[0].date });
      }
      for (const fw of out) {
        model.firmware.push(
          typeof fw.date === "string"
            ? { component: fw.name, version: fw.version, date: fw.date, source: `${recName} (current)` }
            : { component: fw.name, version: fw.version, source: `${recName} (current)` }
        );
      }
    },
  };
}

/** Scan a fully-materialized zbb buffer into the model (whole-record path). */
export function scanZbbInto(model, data, kb, recName) {
  const scanner = createZbbScanner(makeZbbSink(model, kb, recName));
  scanner.push(data);
  scanner.end();
}
