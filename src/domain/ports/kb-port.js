// @ts-check
// Port (contract) for the knowledge-base operations used by the analysis
// pipeline. Implemented by adapters/kb/* (data-backed lookups).

/**
 * @typedef {object} KbPort
 * @property {(classCode:number, eventCode:number, message:string) => string} resolveSeverity
 * @property {(classCode:number, eventCode:number, message:string) => import("../entities/model.js").ResolutionLookup} resolveRcaError
 * @property {(codes:string[], firmware:import("../entities/model.js").FirmwareEntry[], platform:string|null) => import("../entities/model.js").FirmwareAdvisory[]} matchAdvisories
 * @property {(firmware:import("../entities/model.js").FirmwareEntry[], platform:string|null) => import("../entities/model.js").FirmwareAdvisory[]} matchGeneralAdvisories
 */

export {};