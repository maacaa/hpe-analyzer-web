// @ts-check
// Domain model entities: the JSON contract shared with the UI (renderer).
// The renderer mirrors these shapes in `src/renderer/types.ts` (TypeScript).

/**
 * @typedef {"critical"|"warning"|"information"} Severity
 */

/**
 * @typedef {object} ImlEntry
 * @property {string} date           "MM/DD/YYYY HH:MM:SS"
 * @property {number} id             entry id
 * @property {number} classCode
 * @property {number} eventCode
 * @property {"iml"|"iel"|"unknown"} logType
 * @property {Severity} severity
 * @property {string} message
 * @property {string} alarm          message without the trailing ACTION text
 * @property {string|null} resolution official "ACTION:" resolution
 * @property {number|null} timestamp ms epoch
 * @property {string} source         zbb file the entry came from
 */

/**
 * @typedef {object} FirmwareEntry
 * @property {string} component
 * @property {string} version
 * @property {string} displayVersion
 * @property {string} category
 * @property {string|null} date
 * @property {string} format
 * @property {string} [description]
 * @property {string} [formatNote]
 * @property {string} source
 * @property {string} [rawKey]
 */

/**
 * @typedef {"healthy"|"warning"|"failed"} HardwareStatus
 */

/**
 * @typedef {object} HardwareEntry
 * @property {string} type
 * @property {string} [id]
 * @property {string} [manufacturer]
 * @property {string} [model]
 * @property {string} [serialNumber]
 * @property {string} [partNumber]
 * @property {string} [family]
 * @property {string} [speed]
 * @property {string} [cores]
 * @property {string} [cache]
 * @property {string} [stepping]
 * @property {string} [memoryType]
 * @property {string} [moduleType]
 * @property {string} [size]
 * @property {string} [slot]
 * @property {string} [interface]
 * @property {string} [macAddress]
 * @property {string} [adapterType]
 * @property {string} [firmware]
 * @property {string} [capacity]
 * @property {string} [controllerType]
 * @property {string} [driveType]
 * @property {string} [connectedDrives]
 * @property {string} [memorySize]
 * @property {string} [present]
 * @property {string} [redundant]
 * @property {string} [sparePartNumber]
 * @property {string} [correctable]
 * @property {string} [uncorrectable]
 * @property {string} [orderNumber]
 * @property {string} [buildOfMaterials]
 * @property {string} [universalUniqueId]
 * @property {string} [assetTag]
 * @property {string} [skuNumber]
 * @property {string} [totalSystemMemory]
 * @property {string} [systemRomVersion]
 * @property {string} [iloVersion]
 * @property {string} [bmcVersion]
 * @property {string} [cpldVersion]
 * @property {HardwareStatus} [status]
 * @property {Array<{date: string, severity: Severity, message: string}>} [issues] exact IML alarms that produced the status
 * @property {string} source
 */

/**
 * @typedef {object} EventEntry
 * @property {string} date
 * @property {Severity} severity
 * @property {string} message
 * @property {number} classCode
 * @property {number} eventCode
 * @property {number|null} timestamp
 * @property {string} source
 */

/**
 * @typedef {object} AdvisoryResult
 * @property {string|null} component
 * @property {string|null} version
 * @property {boolean} affected
 * @property {string} label
 * @property {string|null} fix
 * @property {string} [name]
 */

/**
 * @typedef {object} FirmwareAdvisory
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} component
 * @property {{min?: string, max?: string}} affectedVersions
 * @property {string} fixedIn
 * @property {Severity} severity
 * @property {string[]} resolvesErrorCodes
 * @property {AdvisoryResult[]} results
 */

/**
 * @typedef {object} ResolutionLookup
 * @property {string|null} title
 * @property {string|null} resolution
 * @property {string|null} symptom
 * @property {string|null} cause
 * @property {string|null} severity
 * @property {string|null} category
 * @property {string[]|null} platforms
 * @property {string|null} url
 */

/**
 * @typedef {object} RcaEntry
 * @property {string} title
 * @property {string[]} components
 * @property {string|null} resolution
 * @property {string|null} [cause]
 * @property {string|null} [symptom]
 * @property {string|null} [category]
 * @property {string[]|null} [platforms]
 * @property {FirmwareAdvisory[]} bugs
 * @property {Severity} severity
 * @property {number} classCode
 * @property {number} eventCode
 * @property {string} docUrl
 * @property {number} count
 * @property {string} lastDate
 * @property {number|null} lastTimestamp
 */

/**
 * @typedef {object} Stats
 * @property {number} records
 * @property {number} zbbFiles
 * @property {number} imlCount
 * @property {number} eventCount
 * @property {number} criticalCount
 * @property {number} warningCount
 */

/**
 * @typedef {object} Model
 * @property {Record<string, unknown>} meta
 * @property {Record<string, string>|null} customerInfo
 * @property {string[]} fileListing
 * @property {string[]} clist
 * @property {{id:number, value:number, name:string}[]} counters
 * @property {FirmwareEntry[]} firmware
 * @property {HardwareEntry[]} hardware
 * @property {ImlEntry[]} iml
 * @property {ImlEntry[]} events
 * @property {RcaEntry[]} rca
 * @property {FirmwareAdvisory[]} advisories
 * @property {Stats} stats
 */

/**
 * Create an empty analysis model for a source file name.
 * @param {string} sourceFile
 * @returns {Model}
 */
export function createEmptyModel(sourceFile) {
  return {
    meta: { sourceFile },
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
  };
}