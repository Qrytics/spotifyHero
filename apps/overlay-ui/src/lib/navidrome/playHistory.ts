/**
 * Local "recently played" list for the music-server library.
 *
 * Subsonic 1.16.1 has no recently-played-*songs* endpoint — `getAlbumList2`
 * offers `recent`, but that is album-granular and needs a drill-down to play
 * anything. So the Recent tab reads this instead: a short ring buffer written
 * the moment a track finishes downloading and decoding, which is also the
 * moment `NavidromePlaybackSource` scrobbles it to the server.
 *
 * Entries store a whole `NavidromeSong` (via `SongSchema`, deliberately reused
 * rather than redeclared) because that is exactly what `prepare()` takes — so a
 * row read back out of localStorage replays with one click, no refetch of the
 * album it came from.
 *
 * Defensive parsing throughout, matching `credentials.ts` and `chartCache.ts`:
 * a corrupt blob yields an empty list rather than an exception, and nothing in
 * here may ever be the reason a song fails to load.
 */
import { z } from "zod";
import { SongSchema, type NavidromeSong } from "./client.js";

const STORAGE_KEY = "spotifyHero_navidrome_history_v1";

/**
 * Deliberately small: the window is 180 px wide, so a list this long already
 * needs scrolling, and the quota cost is noise next to the chart cache.
 */
export const MAX_HISTORY = 30;

export const PlayHistoryEntrySchema = z.object({
  song: SongSchema,
  /**
   * Which server the song id belongs to. Ids are not portable, so entries from
   * another server are filtered out rather than shown as rows that can't load.
   */
  serverUrl: z.string().min(1),
  playedAt: z.number(),
});
export type PlayHistoryEntry = z.infer<typeof PlayHistoryEntrySchema>;

/** Tolerant of individual bad entries: they are dropped, the rest survive. */
function readAll(): PlayHistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const json: unknown = JSON.parse(raw);
    if (!Array.isArray(json)) return [];
    const out: PlayHistoryEntry[] = [];
    for (const item of json) {
      const parsed = PlayHistoryEntrySchema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}

function writeAll(entries: PlayHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private-mode failure: history is a convenience, never load-bearing.
  }
}

/** Newest first, limited to the server currently signed in. */
export function loadPlayHistory(serverUrl: string): PlayHistoryEntry[] {
  return readAll()
    .filter((e) => e.serverUrl === serverUrl)
    .sort((a, b) => b.playedAt - a.playedAt);
}

/**
 * Records a play, de-duplicated by song id: replaying a song moves it back to
 * the front instead of adding a second row. The list is stored newest-first and
 * capped at `MAX_HISTORY` across all servers.
 */
export function recordPlayed(serverUrl: string, song: NavidromeSong): void {
  const rest = readAll().filter(
    (e) => !(e.serverUrl === serverUrl && e.song.id === song.id)
  );
  const entry: PlayHistoryEntry = { song, serverUrl, playedAt: Date.now() };
  // Sort before capping so the entry dropped is the genuinely oldest one, even
  // if an older blob was stored out of order.
  const next = [entry, ...rest].sort((a, b) => b.playedAt - a.playedAt);
  writeAll(next.slice(0, MAX_HISTORY));
}

export function clearPlayHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
