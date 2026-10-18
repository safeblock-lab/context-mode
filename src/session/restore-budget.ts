/** Rendering limits only: the event store and searchable export stay intact. */
export const RESTORE_MAX_BYTES = 32 * 1024;

export function normalizeBudget(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, RESTORE_MAX_BYTES) : RESTORE_MAX_BYTES;
}

export function prefix(value: string, bytes: number): string {
  let result = "";
  let used = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (used + size > bytes) break;
    result += char;
    used += size;
  }
  return result;
}

/** XML 1.0 characters only, including replacement of unpaired surrogates. */
export function safeXML(value: string, bytes = 512): string {
  return prefix(value, bytes)
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "\uFFFD")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Bound the escaped output too: XML entities can expand a source prefix sixfold. */
export function safeXMLSnippet(value: string, bytes: number): string {
  let sourceBytes = bytes;
  let escaped = safeXML(value, sourceBytes);
  while (Buffer.byteLength(escaped) > bytes) {
    sourceBytes = Math.floor(sourceBytes / 2);
    escaped = safeXML(value, sourceBytes);
  }
  return escaped;
}

/** Pack whole XML sections in priority order; never cut XML or entities. */
export function packSnapshot(sections: string[], maxBytes: unknown, attributes = ""): string {
  const budget = normalizeBudget(maxBytes);
  const header = `<session_resume${attributes}>`;
  const footer = "</session_resume>";
  let result = header;
  if (Buffer.byteLength(header + "\n" + footer) > budget) {
    return budget >= 17 ? "<session_resume/>" : "";
  }
  for (const section of sections) {
    if (Buffer.byteLength(result + "\n" + section + "\n" + footer) <= budget) {
      result += "\n" + section;
    }
  }
  return result + "\n" + footer;
}

const LEGACY_SECTIONS = ["session_goal", "task_state", "intent", "recent_user_messages",
  "files", "decisions", "rules", "environment", "errors", "git", "subagents", "skills", "roles"];

/** Treat cached XML as untrusted text. Rebuild known sections without its markup. */
export function sanitizeLegacySnapshot(snapshot: string, maxBytes: unknown): string {
  const sections: string[] = [];
  for (const tag of LEGACY_SECTIONS) {
    const match = snapshot.match(new RegExp(`<${tag}(?:\\s[^>]*?)?>([\\s\\S]*?)</${tag}>`));
    if (!match) {
      if (tag === "intent") {
        const intent = snapshot.match(/<intent\s+mode="([^"]*)"\s*\/>/);
        if (intent) sections.push(`  <intent mode="${safeXML(intent[1])}"/>`);
      }
      continue;
    }
    // Bound before decoding and stripping: arbitrary legacy payloads never render verbatim.
    const text = prefix(match[1], 2048).split("For full details:")[0].replace(/<[^>]*>/g, "")
      .replace(/&(?:lt|gt|quot|apos|amp);/g, entity =>
        ({ "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" })[entity] ?? entity);
    const query = JSON.stringify([prefix(text.trim(), 80) || tag]);
    sections.push(`  <${tag}>${safeXML(text, 1024)}\nctx_search(queries: ${safeXML(query)}, source: "session-events")</${tag}>`);
  }
  return packSnapshot([
    '  <how_to_search>Full events remain available: ctx_search(queries: ["session"], source: "session-events").</how_to_search>',
    ...sections,
  ], maxBytes);
}
