// Budgets measure serialized UTF-16 code units, including JSON escaping and notices.
// They are not token counts. Keep this independent of any client tokenizer.
export const defaultContextChars = 12_000;
export const maxContextChars = 100_000;

export function boundedContext(value: Record<string, unknown>, maxChars = defaultContextChars) {
  if (!Number.isInteger(maxChars) || maxChars < 1024 || maxChars > maxContextChars) {
    throw new Error(`Context budget must be an integer from 1024 to ${maxContextChars}`);
  }
  const clean = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  // Keep paging controls outside content trimming. Advance by events actually
  // returned, so a size cap cannot make callers skip unseen events.
  const eventPage = clean.eventPage as { total: number; eventOffset?: number; [key: string]: unknown } | undefined;
  delete clean.eventPage;
  let truncated = false;
  const budget = {
    maxChars, truncated: false,
    detailHint: "Narrow memory_search or increase maxChars (up to 100000); page memory_get_session with eventOffset/eventLimit for older events.",
  };
  const size = (item: unknown) => JSON.stringify(item).length;
  function fit(item: any, available: number): any {
    if (size(item) <= available) return item;
    truncated = true;
    if (typeof item === "string") {
      const suffix = "…[truncated]";
      let low = 0, high = item.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (size(item.slice(0, middle) + suffix) <= available) low = middle;
        else high = middle - 1;
      }
      return size(suffix) <= available ? item.slice(0, low) + suffix : null;
    }
    if (Array.isArray(item)) {
      const kept: unknown[] = [];
      for (const entry of item) {
        const remaining = available - size(kept) - 1;
        if (remaining < 32) break;
        // Preserve relevance order while leaving space for additional matches.
        const next = fit(entry, Math.min(remaining, Math.max(256, Math.floor(available / 2))));
        if (size([...kept, next]) > available) break;
        kept.push(next);
      }
      return kept;
    }
    if (item && typeof item === "object") {
      const kept: Record<string, unknown> = {};
      // IDs survive before potentially large text/metadata fields.
      const entries = Object.entries(item).sort(([a], [b]) => Number(/^(id|.*Id)$/.test(b)) - Number(/^(id|.*Id)$/.test(a)));
      for (let index = 0; index < entries.length; index++) {
        const [key, entry] = entries[index];
        const remaining = available - size(kept) - size(key) - 2;
        if (remaining < 4) continue;
        const allowance = Math.floor(remaining / (entries.length - index));
        if (allowance < 4) continue;
        const next = key === "events" && Array.isArray(entry)
          ? fit([...entry].reverse(), allowance).reverse()
          : fit(entry, allowance);
        if (size({ ...kept, [key]: next }) <= available) kept[key] = next;
      }
      return kept;
    }
    return null;
  }
  const pageReserve = eventPage ? size({ eventPage }) + 64 : 0;
  const data = fit(clean, maxChars - size({ contextBudget: budget }) - pageReserve - 2);
  budget.truncated = truncated;
  if (eventPage) {
    const events = data.events ?? data.session?.events ?? [];
    const offset = eventPage.eventOffset ?? 0;
    const next = offset + events.length;
    data.eventPage = { ...eventPage, returned: events.length, nextOffset: next < eventPage.total ? next : null };
  }
  return { ...data, contextBudget: budget } as Record<string, unknown>;
}

export function uniqueMemories<T extends { text: string }>(memories: T[]): T[] {
  const seen = new Set<string>();
  return memories.filter(memory => {
    const key = memory.text.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
