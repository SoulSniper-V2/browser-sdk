import type { CacheConfig } from "./types.js";

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(config: CacheConfig = {}) {
    this.ttlMs = config.ttlMs ?? 60_000;
    this.maxEntries = config.maxEntries ?? 100;
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    if (this.ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      return Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b)));
    }
    return child;
  });
}
