import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NavidromeSong } from "./client.js";
import {
  MAX_HISTORY,
  clearPlayHistory,
  loadPlayHistory,
  recordPlayed,
} from "./playHistory.js";

const STORAGE_KEY = "spotifyHero_navidrome_history_v1";
const SERVER = "https://music.example.com";

/** See the note in `credentials.test.ts`: node has no `localStorage`. */
class FakeStorage {
  private readonly entries = new Map<string, string>();
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

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "localStorage");
});

function song(id: string, over: Partial<NavidromeSong> = {}): NavidromeSong {
  return { id, title: `Song ${id}`, artist: "Someone", duration: 210, ...over };
}

/** Each `recordPlayed` needs a distinct timestamp for ordering to be meaningful. */
function play(id: string, over?: Partial<NavidromeSong>): void {
  vi.advanceTimersByTime(1000);
  recordPlayed(SERVER, song(id, over));
}

describe("recordPlayed / loadPlayHistory", () => {
  it("lists songs newest first", () => {
    play("a");
    play("b");
    play("c");
    expect(loadPlayHistory(SERVER).map((e) => e.song.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("moves a replayed song to the front instead of duplicating it", () => {
    play("a");
    play("b");
    play("a");
    expect(loadPlayHistory(SERVER).map((e) => e.song.id)).toEqual(["a", "b"]);
  });

  it("keeps the whole song, so a stored row can be replayed as-is", () => {
    play("a", { albumId: "al-1", coverArt: "ca-1", track: 4, bpm: 128 });
    const entry = loadPlayHistory(SERVER)[0]!;
    expect(entry.song).toMatchObject({
      id: "a",
      title: "Song a",
      albumId: "al-1",
      coverArt: "ca-1",
      track: 4,
      bpm: 128,
    });
    expect(entry.playedAt).toBeGreaterThan(0);
  });

  it("normalizes bpm: 0 back to undefined on the way out, like SongSchema does", () => {
    play("a", { bpm: 0 });
    expect(loadPlayHistory(SERVER)[0]!.song.bpm).toBeUndefined();
  });

  it("caps the list and drops the oldest entry", () => {
    for (let i = 0; i < MAX_HISTORY + 5; i += 1) play(`s${i}`);
    const ids = loadPlayHistory(SERVER).map((e) => e.song.id);
    expect(ids).toHaveLength(MAX_HISTORY);
    expect(ids[0]).toBe(`s${MAX_HISTORY + 4}`);
    expect(ids).not.toContain("s0");
  });

  it("hides entries belonging to another server, whose ids would not resolve", () => {
    play("a");
    vi.advanceTimersByTime(1000);
    recordPlayed("https://other.example.com", song("b"));

    expect(loadPlayHistory(SERVER).map((e) => e.song.id)).toEqual(["a"]);
    expect(
      loadPlayHistory("https://other.example.com").map((e) => e.song.id)
    ).toEqual(["b"]);
  });

  it("treats the same id on two servers as two separate entries", () => {
    play("a");
    vi.advanceTimersByTime(1000);
    recordPlayed("https://other.example.com", song("a"));
    expect(loadPlayHistory(SERVER)).toHaveLength(1);
    expect(loadPlayHistory("https://other.example.com")).toHaveLength(1);
  });

  it("clears on demand", () => {
    play("a");
    clearPlayHistory();
    expect(loadPlayHistory(SERVER)).toEqual([]);
  });
});

describe("bad state", () => {
  it("returns an empty list for a corrupt blob", () => {
    storage.setItem(STORAGE_KEY, "{not json");
    expect(loadPlayHistory(SERVER)).toEqual([]);
  });

  it("returns an empty list when the blob is not an array", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ song: "nope" }));
    expect(loadPlayHistory(SERVER)).toEqual([]);
  });

  it("drops individual unparseable entries and keeps the rest", () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { song: { id: "good", title: "Fine" }, serverUrl: SERVER, playedAt: 2 },
        { song: { title: "no id" }, serverUrl: SERVER, playedAt: 3 },
        "garbage",
      ])
    );
    expect(loadPlayHistory(SERVER).map((e) => e.song.id)).toEqual(["good"]);
  });

  it("swallows a quota failure on write", () => {
    storage.limit = 4;
    expect(() => play("a")).not.toThrow();
    expect(loadPlayHistory(SERVER)).toEqual([]);
  });

  it("works with no localStorage at all", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    expect(() => recordPlayed(SERVER, song("a"))).not.toThrow();
    expect(loadPlayHistory(SERVER)).toEqual([]);
  });
});
