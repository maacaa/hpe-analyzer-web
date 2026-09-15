// Knowledge-base adapter: exposes the KB operations required by the analysis
// pipeline through a single KbPort implementation (data-backed lookups).

import { resolveSeverity } from "./iml-codes.js";
import { resolveRcaError } from "./iml-resolutions.js";
import { matchAdvisories, matchGeneralAdvisories } from "./advisory-match.js";

/**
 * Build the default knowledge-base port implementation.
 * @returns {import("../../domain/ports/kb-port.js").KbPort}
 */
export function createDefaultKb() {
  return { resolveSeverity, resolveRcaError, matchAdvisories, matchGeneralAdvisories };
}