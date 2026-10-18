import { buildResumeSnapshot, type StoredEvent } from "./snapshot.js";
import { normalizeBudget, prefix, sanitizeLegacySnapshot } from "./restore-budget.js";

// Leave room under Codex's approximate 2500-token hook preview default.
// The 32-KiB ceiling still applies to explicitly supplied budgets.
export const CODEX_RESTORE_DEFAULT_BYTES = 8 * 1024;

/** One budget covers routing, event summaries and previously saved snapshots. */
export function buildCodexRestoreContext(
  routing: string, events: StoredEvent[], legacy: string | null, maxBytes?: number,
): string {
  const budget = normalizeBudget(maxBytes ?? CODEX_RESTORE_DEFAULT_BYTES);
  // A future oversized routing template must not consume the restoration budget.
  const route = Buffer.byteLength(routing) <= Math.min(budget, 8192)
    ? routing : prefix("Use context-mode search for full session details.", budget);
  let remaining = budget - Buffer.byteLength(route);
  if (remaining < 128 || (!events.length && !legacy)) return route;
  const legacyBudget = legacy ? Math.min(8192, Math.floor(remaining / (events.length ? 4 : 1))) : 0;
  const cached = legacy ? sanitizeLegacySnapshot(legacy, Math.max(0, legacyBudget - 2)) : "";
  remaining -= cached ? Buffer.byteLength(cached) + 2 : 0;
  const current = events.length ? buildResumeSnapshot(events, {
    maxBytes: Math.max(0, remaining - 2), searchTool: "ctx_search",
  }) : "";
  return route + (current ? `\n\n${current}` : "") + (cached ? `\n\n${cached}` : "");
}
