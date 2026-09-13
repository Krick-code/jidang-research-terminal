export type JsonOutputResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "truncated" | "invalid" };

export function parseJsonOutput<T>(content: string, finishReason?: string | null): JsonOutputResult<T> {
  let normalized = content.trim();
  normalized = normalized.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const attempts = [normalized];
  const objectStart = normalized.indexOf("{");
  const objectEnd = normalized.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) attempts.push(normalized.slice(objectStart, objectEnd + 1));
  for (const candidate of attempts) {
    try { return { ok: true, value: JSON.parse(candidate) as T }; }
    catch { /* Try the next safely bounded candidate. */ }
  }
  const incompleteObject = objectStart >= 0 && (objectEnd < objectStart || !normalized.endsWith("}"));
  return { ok: false, reason: finishReason === "length" || incompleteObject ? "truncated" : "invalid" };
}
