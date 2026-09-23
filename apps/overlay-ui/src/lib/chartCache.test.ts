import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ONSET_ANALYSIS_VERSION } from "@spotifyhero/onset-analysis";
import type { Chart } from "@spotifyhero/shared-types";
import {
  clearMemoryChartCache,
  clearPersistedChartCache,
  getCachedChart,
  putCachedChart,
} from "./chartCache.js";

const STORAGE_KEY = "spotifyHero_chartCache_v1";

/**
 * vitest runs this app's tests in node, where `localStorage` does not exist —
 * `chartCache` therefore falls back to memory-only, which is exactly the path
 * the persistence tests must not take. A `Map` is enough of a `Storage`:
 * `chartCache` only calls `getItem`/`setItem`/`removeItem`.
 */
class FakeStorage {
  private readonly entries = new Map<string, string>();
  /** Bytes allowed before `setItem` throws, mimicking a quota. */
  limit = Infinity;

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (value.length > this.limit) {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    this.entries.set(key, value);
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

/**
 * `defineProperty` rather than plain assignment: some node builds expose
 * `localStorage` as a getter-only global, where assigning would throw.
 */
function installStorage(value: unknown): void {
  Object.defineProperty(globalThis, "localStorage", {
    value,
    configurable: true,
    writable: true,
  });
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  installStorage(storage);
  clearMemoryChartCache();
  clearPersistedChartCache();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

function chart(over: Partial<Chart> = {}): Chart {
  return {
    trackId: "nd:abc",
    difficulty: "medium",
    notes: [
      { timeMs: 1000, lane: 0, durationMs: 0 },
      { timeMs: 1500, lane: 2, durationMs: 420, pitchHz: 440 },
    ],
    bpm: 128,
    generatorVersion: "hybrid-deterministic-v1",
    generatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

/** What the persisted layer actually holds, for the invalidation tests. */
function rawEntries(): Array<Record<string, unknown>> {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
}

describe("chartCache", () => {
  it("round-trips a chart through memory", () => {
    const c = chart();
    putCachedChart(c);
    // Same object: a memory hit should not pay for a parse.
    expect(getCachedChart("nd:abc", "medium")).toBe(c);
  });

  it("keys on difficulty as well as track", () => {
    putCachedChart(chart({ difficulty: "expert" }));
    expect(getCachedChart("nd:abc", "expert")).not.toBeNull();
    expect(getCachedChart("nd:abc", "medium")).toBeNull();
  });

  it("re-reads a chart from storage after memory is dropped", () => {
    putCachedChart(chart());
    clearMemoryChartCache();

    const hit = getCachedChart("nd:abc", "medium");
    expect(hit).not.toBeNull();
    expect(hit?.notes).toHaveLength(2);
    // `generatedAt` came back as a JSON string; `z.coerce.date()` is what makes
    // the round trip produce a `Date` again.
    expect(hit?.generatedAt).toBeInstanceOf(Date);
    expect(hit?.generatedAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(hit?.notes[1]?.pitchHz).toBe(440);
  });

  it("stamps the analysis version and ignores entries from another one", () => {
    putCachedChart(chart());
    expect(rawEntries()[0]?.["analysisVersion"]).toBe(ONSET_ANALYSIS_VERSION);

    // Simulate the first launch after the onset constants were retuned.
    const stale = rawEntries().map((e) => ({ ...e, analysisVersion: "onset-0" }));
    storage.setItem(STORAGE_KEY, JSON.stringify(stale));
    clearMemoryChartCache();

    expect(getCachedChart("nd:abc", "medium")).toBeNull();
  });

  it("drops entries from a previous generator version on write", () => {
    putCachedChart(chart({ trackId: "nd:old", generatorVersion: "hybrid-ml-v0" }));
    putCachedChart(chart({ trackId: "nd:new" }));

    const keys = rawEntries().map((e) => e["key"]);
    expect(keys).toEqual(["nd:new|medium"]);
  });

  it("discards a stored entry that no longer parses", () => {
    putCachedChart(chart());
    const corrupted = rawEntries().map((e) => ({
      ...e,
      chart: { ...(e["chart"] as Record<string, unknown>), bpm: -1 },
    }));
    storage.setItem(STORAGE_KEY, JSON.stringify(corrupted));
    clearMemoryChartCache();

    expect(getCachedChart("nd:abc", "medium")).toBeNull();
    // Self-healing: the unreadable entry is gone rather than retried forever.
    expect(rawEntries()).toHaveLength(0);
  });

  it("survives unreadable storage", () => {
    storage.setItem(STORAGE_KEY, "{not json");
    const c = chart();
    putCachedChart(c);
    expect(getCachedChart("nd:abc", "medium")).toBe(c);
  });

  it("keeps the newest chart when the quota rejects the write", () => {
    putCachedChart(chart({ trackId: "nd:one" }));
    putCachedChart(chart({ trackId: "nd:two" }));

    // Only one entry's worth of room from here on.
    storage.limit = (storage.getItem(STORAGE_KEY)?.length ?? 0) * 0.8;
    putCachedChart(chart({ trackId: "nd:three" }));

    const keys = rawEntries().map((e) => e["key"]);
    expect(keys).toContain("nd:three|medium");
    clearMemoryChartCache();
    expect(getCachedChart("nd:three", "medium")).not.toBeNull();
  });

  it("evicts nothing the caller can still ask for in memory", () => {
    // 8 memory entries is the cap; the 9th must evict the least-recent.
    const difficulties = ["easy", "medium", "hard", "expert"] as const;
    for (let i = 0; i < 5; i++) {
      for (const difficulty of difficulties) {
        putCachedChart(chart({ trackId: `nd:${i}`, difficulty }));
      }
    }
    // The most recent four are certainly still resident.
    for (const difficulty of difficulties) {
      expect(getCachedChart("nd:4", difficulty)).not.toBeNull();
    }
  });
});
