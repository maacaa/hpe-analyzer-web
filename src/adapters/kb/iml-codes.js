// IML event-code -> severity map (adapter implementing KbPort.resolveSeverity).
//
// Keyed by `class|event` as 4-hex-digit lowercase (e.g. "000a|0469").
// The primary table is generated from the official "Integrated Management Log
// Messages and Troubleshooting Guide for HPE ProLiant Gen10/Gen11/Gen12"
// (docId ilogen12-msg-en_us) via `iml-events.js`. Unknown codes fall back to
// the heuristic from the domain services layer.

import { IML_EVENTS } from "./iml-events.js";
import { heuristicSeverity } from "../../domain/services/iml-format.js";

export const IML_SEVERITY = {};

for (const e of IML_EVENTS) {
  const key =
    e.class.toString(16).padStart(4, "0") +
    "|" +
    e.event.toString(16).padStart(4, "0");
  IML_SEVERITY[key] = e.severity;
}

/** Resolve severity for an IML entry (code map first, heuristics second). */
export function resolveSeverity(classCode, eventCode, message) {
  const key =
    classCode.toString(16).padStart(4, "0") +
    "|" +
    eventCode.toString(16).padStart(4, "0");
  if (IML_SEVERITY[key]) return IML_SEVERITY[key];
  return heuristicSeverity(message);
}