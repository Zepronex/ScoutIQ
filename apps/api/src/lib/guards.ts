/**
 * Small in-process guards that keep one instance cheap to run under load.
 * They hold state in memory, so they assume a single running instance.
 */

type Entry<T> = { expires: number; value: Promise<T> };

/**
 * Shares one result between every caller that asks for the same key within
 * `ttlMs`, including callers that arrive while the first load is in flight.
 * A burst of identical requests then costs one database round trip.
 */
export function createTtlCache<T>(ttlMs: number, maxEntries = 100, now: () => number = Date.now) {
  const entries = new Map<string, Entry<T>>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const cached = entries.get(key);
      if (cached && cached.expires > now()) return cached.value;
      const value = load();
      entries.delete(key);
      entries.set(key, { expires: now() + ttlMs, value });
      // Failed loads are not kept, so the next caller retries.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
      return value;
    },
    clear(): void {
      entries.clear();
    }
  };
}

/**
 * Allows `limit` uses per UTC day across all callers. Used for anything billed
 * per call, where a per-client limit cannot cap the total.
 */
export function createDailyBudget(limit: number, now: () => number = Date.now) {
  let day = '';
  let used = 0;
  return {
    tryConsume(): boolean {
      const today = new Date(now()).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= limit) return false;
      used += 1;
      return true;
    },
    remaining(): number {
      return new Date(now()).toISOString().slice(0, 10) === day ? Math.max(0, limit - used) : limit;
    }
  };
}

export function readLimit(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}
