// @ts-check
// Event log use case: collapse snapshot duplicates and sort newest-first.

/**
 * The AHS stores the iLO Event Log as repeated snapshots across the .zbb files,
 * so the same entry can appear many times. Collapse exact duplicates and
 * present the remaining events newest-first.
 *
 * @param {import("../entities/model.js").ImlEntry[]} events
 * @returns {import("../entities/model.js").ImlEntry[]}
 */
export function finalizeEvents(events) {
  const seen = new Set();
  return events
    .filter((e) => {
      const k = `${e.date}|${e.classCode}|${e.eventCode}|${e.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}