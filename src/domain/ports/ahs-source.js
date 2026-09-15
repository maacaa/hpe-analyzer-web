// @ts-check
// Port (contract) for reading raw AHS records. Implemented by adapters that
// decode the .ahs container (e.g. adapters/parsers/ahs-container.js).

/**
 * @typedef {object} RawRecord
 * @property {string} name
 * @property {number} size
 * @property {number} bits
 * @property {number} checksum
 * @property {Uint8Array} large
 * @property {Uint8Array|null} data
 * @property {string|null} error
 * @property {number} offset
 */

/**
 * @typedef {object} AhsSource
 * @property {number} totalBytes
 * @property {() => AsyncIterable<RawRecord>} readRecords
 */

export {};