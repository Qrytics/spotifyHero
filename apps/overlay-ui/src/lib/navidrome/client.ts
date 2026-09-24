/**
 * Thin typed wrapper over the Subsonic REST API as exposed by Navidrome
 * (verified against Navidrome 0.63.2 / Subsonic API 1.16.1, `openSubsonic: true`).
 *
 * Why the renderer talks to the server directly rather than going through Rust:
 * `/rest/ping`, `/rest/stream` and `/rest/getCoverArt` all return
 * `access-control-allow-origin: *` and preflight passes, and the decode path
 * needs the bytes inside the webview anyway. `packages/leaderboard-client`
 * already sets the precedent (it hits Supabase PostgREST from the renderer).
 *
 * Auth is classic Subsonic `u` + `s`(salt) + `t`(md5(password+salt)); the server
 * does **not** advertise the `apiKeyAuthentication` OpenSubsonic extension, so
 * there is no bearer-token alternative.
 *
 * Zod validates at the boundary — same convention as `TauriSpotifyPoller`.
 */
import { z } from "zod";
import type { NavidromeCredentials } from "./credentials.js";

/** Subsonic protocol version we claim. Navidrome 0.63.2 reports 1.16.1. */
const API_VERSION = "1.16.1";
/** `c` param — shows up in Navidrome's "players" list. */
const CLIENT_NAME = "spotifyHero";

/**
 * Tracks longer than this are refused: the whole file is decoded into a single
 * `AudioBuffer` (~23 MB/min stereo @48 kHz Float32), and the analysis pass is
 * linear in length. Streaming long tracks is out of scope for v1.
 */
export const SERVER_MAX_TRACK_MS = 12 * 60_000;

/** `nd:` namespaces Subsonic ids so they can never collide with Spotify ids. */
export const SERVER_TRACK_ID_PREFIX = "nd:";

export function toGameTrackId(subsonicId: string): string {
  return `${SERVER_TRACK_ID_PREFIX}${subsonicId}`;
}

/** Inverse of `toGameTrackId`; returns null for non-server ids. */
export function toSubsonicId(gameTrackId: string): string | null {
  return gameTrackId.startsWith(SERVER_TRACK_ID_PREFIX)
    ? gameTrackId.slice(SERVER_TRACK_ID_PREFIX.length)
    : null;
}

// ---------------------------------------------------------------------------
// Boundary schemas
// ---------------------------------------------------------------------------

const SubsonicErrorSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
});

/** Every JSON response is wrapped in `subsonic-response`. */
const EnvelopeSchema = z.object({
  "subsonic-response": z
    .object({
      status: z.string(),
      version: z.string().optional(),
      type: z.string().optional(),
      serverVersion: z.string().optional(),
      openSubsonic: z.boolean().optional(),
      error: SubsonicErrorSchema.optional(),
    })
    .passthrough(),
});

export const ArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  coverArt: z.string().optional(),
  albumCount: z.number().int().nonnegative().optional(),
});
export type NavidromeArtist = z.infer<typeof ArtistSchema>;

export const AlbumSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string().optional(),
  artistId: z.string().optional(),
  coverArt: z.string().optional(),
  songCount: z.number().int().nonnegative().optional(),
  /** Seconds, per the Subsonic spec. */
  duration: z.number().nonnegative().optional(),
  year: z.number().int().optional(),
  genre: z.string().optional(),
});
export type NavidromeAlbum = z.infer<typeof AlbumSchema>;

/** Subsonic `Child` restricted to what the library UI and the player need. */
export const SongSchema = z.object({
  id: z.string(),
  title: z.string(),
  album: z.string().optional(),
  albumId: z.string().optional(),
  artist: z.string().optional(),
  artistId: z.string().optional(),
  coverArt: z.string().optional(),
  track: z.number().int().optional(),
  discNumber: z.number().int().optional(),
  year: z.number().int().optional(),
  /** **Seconds** (integer) — coarse. Prefer the decoded buffer's exact length. */
  duration: z.number().nonnegative().optional(),
  suffix: z.string().optional(),
  contentType: z.string().optional(),
  size: z.number().nonnegative().optional(),
  bitRate: z.number().nonnegative().optional(),
  /**
   * OpenSubsonic tag field. A hint for cross-checking only — real tempo comes from
   * analysis, and `trackFromSong` drops it entirely.
   *
   * Navidrome sends `bpm: 0` for files with no BPM tag, which is most of a real
   * library, so this must not be `.positive()` — that rejected whole albums. `0` is
   * normalized to `undefined` rather than passed through, because every consumer
   * reads it as `track.bpm ?? 120` and `0` is not nullish: letting it through would
   * hand the calibrator a zero-BPM beat grid.
   */
  bpm: z
    .number()
    .optional()
    .transform((v) => (v !== undefined && v > 0 ? v : undefined)),
});
export type NavidromeSong = z.infer<typeof SongSchema>;

export const PlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  songCount: z.number().int().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
  coverArt: z.string().optional(),
});
export type NavidromePlaylist = z.infer<typeof PlaylistSchema>;

const ArtistsResponseSchema = z.object({
  artists: z
    .object({
      index: z
        .array(
          z.object({
            name: z.string(),
            artist: z.array(ArtistSchema).default([]),
          })
        )
        .default([]),
    })
    .default({}),
});

const ArtistResponseSchema = z.object({
  artist: ArtistSchema.extend({ album: z.array(AlbumSchema).default([]) }),
});

const AlbumResponseSchema = z.object({
  album: AlbumSchema.extend({ song: z.array(SongSchema).default([]) }),
});

const AlbumList2ResponseSchema = z.object({
  albumList2: z.object({ album: z.array(AlbumSchema).default([]) }).default({}),
});

const Search3ResponseSchema = z.object({
  searchResult3: z
    .object({
      artist: z.array(ArtistSchema).default([]),
      album: z.array(AlbumSchema).default([]),
      song: z.array(SongSchema).default([]),
    })
    .default({}),
});

const RandomSongsResponseSchema = z.object({
  randomSongs: z.object({ song: z.array(SongSchema).default([]) }).default({}),
});

const PlaylistsResponseSchema = z.object({
  playlists: z
    .object({ playlist: z.array(PlaylistSchema).default([]) })
    .default({}),
});

const PlaylistResponseSchema = z.object({
  playlist: PlaylistSchema.extend({ entry: z.array(SongSchema).default([]) }),
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NavidromeError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "auth" | "server" | "schema" | "content-type",
    readonly code?: number
  ) {
    super(message);
    this.name = "NavidromeError";
  }
}

/** Subsonic error codes that mean "your credential is bad", not "try again". */
function isAuthCode(code: number): boolean {
  // 40 wrong username/password, 41 token auth not supported,
  // 42 provided auth mechanism not supported, 43 multiple conflicting,
  // 44 invalid API key, 50 user not authorized.
  return code === 40 || code === 41 || code === 42 || code === 43 || code === 44 || code === 50;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type AlbumListType = "newest" | "frequent" | "recent" | "random" | "starred" | "alphabeticalByName";

/** Default page size. `getAlbumList2` caps `size` at 500. */
export const PAGE_SIZE = 100;

export class NavidromeClient {
  constructor(private readonly creds: NavidromeCredentials) {}

  get serverUrl(): string {
    return this.creds.serverUrl;
  }

  get username(): string {
    return this.creds.username;
  }

  /** Builds a fully authenticated `/rest/<endpoint>` URL. */
  url(endpoint: string, params: Record<string, string | number | undefined> = {}): string {
    const u = new URL(`${this.creds.serverUrl}/rest/${endpoint}`);
    u.searchParams.set("u", this.creds.username);
    u.searchParams.set("t", this.creds.token);
    u.searchParams.set("s", this.creds.salt);
    u.searchParams.set("v", API_VERSION);
    u.searchParams.set("c", CLIENT_NAME);
    u.searchParams.set("f", "json");
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  /**
   * JSON request + envelope unwrap. Subsonic answers errors with HTTP 200 and
   * `status: "failed"`, so the status code alone proves nothing.
   */
  // Generic over the schema, not its output: `z.ZodType<T>` defaults its Input
  // param to T, so every `.default()` in the response schemas would leak back
  // into T as optional and make each array `| undefined` at the call sites.
  private async getJson<S extends z.ZodTypeAny>(
    endpoint: string,
    params: Record<string, string | number | undefined>,
    schema: S,
    signal?: AbortSignal
  ): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await fetch(this.url(endpoint, params), {
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      throw new NavidromeError(
        `Cannot reach music server: ${e instanceof Error ? e.message : String(e)}`,
        "network"
      );
    }
    if (!res.ok) {
      throw new NavidromeError(`${endpoint} failed: HTTP ${res.status}`, "server");
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new NavidromeError(`${endpoint} returned a non-JSON body`, "schema");
    }

    const envelope = EnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new NavidromeError(
        `${endpoint} response was not a subsonic-response envelope`,
        "schema"
      );
    }
    const body = envelope.data["subsonic-response"];
    if (body.status !== "ok") {
      const code = body.error?.code ?? -1;
      throw new NavidromeError(
        body.error?.message ?? `${endpoint} failed (code ${code})`,
        isAuthCode(code) ? "auth" : "server",
        code
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      if (import.meta.env.DEV) {
        console.warn(`[spotifyHero] ${endpoint} payload mismatch:`, parsed.error.issues, body);
      }
      // Field paths in the message, not just in a console nobody can open in a
      // 180px overlay: a Subsonic server that returns one unexpected field is
      // unfixable from "did not match the expected shape". Paths and Zod's own
      // wording only — never the values, which are library metadata.
      const issues = parsed.error.issues;
      const detail = issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ");
      const more = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
      throw new NavidromeError(
        `${endpoint} payload did not match the expected shape — ${detail}${more}`,
        "schema"
      );
    }
    return parsed.data;
  }

  // -- Auth -----------------------------------------------------------------

  /** Throws `NavidromeError("auth")` when the credential is wrong. */
  async ping(signal?: AbortSignal): Promise<void> {
    await this.getJson("ping", {}, z.object({}).passthrough(), signal);
  }

  // -- Browse ---------------------------------------------------------------

  /** Alphabet-indexed artist list, flattened — the UI renders one scrolling list. */
  async getArtists(signal?: AbortSignal): Promise<NavidromeArtist[]> {
    const data = await this.getJson("getArtists", {}, ArtistsResponseSchema, signal);
    return data.artists.index.flatMap((i) => i.artist);
  }

  async getArtistAlbums(artistId: string, signal?: AbortSignal): Promise<NavidromeAlbum[]> {
    const data = await this.getJson("getArtist", { id: artistId }, ArtistResponseSchema, signal);
    return data.artist.album;
  }

  async getAlbumSongs(albumId: string, signal?: AbortSignal): Promise<NavidromeSong[]> {
    const data = await this.getJson("getAlbum", { id: albumId }, AlbumResponseSchema, signal);
    return data.album.song;
  }

  async getAlbumList(
    type: AlbumListType,
    opts: { size?: number; offset?: number } = {},
    signal?: AbortSignal
  ): Promise<NavidromeAlbum[]> {
    const data = await this.getJson(
      "getAlbumList2",
      { type, size: opts.size ?? PAGE_SIZE, offset: opts.offset ?? 0 },
      AlbumList2ResponseSchema,
      signal
    );
    return data.albumList2.album;
  }

  async search(
    query: string,
    opts: { artistCount?: number; albumCount?: number; songCount?: number } = {},
    signal?: AbortSignal
  ): Promise<{
    artists: NavidromeArtist[];
    albums: NavidromeAlbum[];
    songs: NavidromeSong[];
  }> {
    const data = await this.getJson(
      "search3",
      {
        query,
        artistCount: opts.artistCount ?? 10,
        albumCount: opts.albumCount ?? 10,
        songCount: opts.songCount ?? 40,
      },
      Search3ResponseSchema,
      signal
    );
    const r = data.searchResult3;
    return { artists: r.artist, albums: r.album, songs: r.song };
  }

  /**
   * A fresh random deal of songs. Navidrome caps `size` at 500 and re-rolls on
   * every call, so the caller gets a different set each time with no cursor to
   * keep. Over-fetch if you intend to filter (e.g. by `isTrackTooLong`).
   */
  async getRandomSongs(size: number, signal?: AbortSignal): Promise<NavidromeSong[]> {
    const data = await this.getJson(
      "getRandomSongs",
      { size },
      RandomSongsResponseSchema,
      signal
    );
    return data.randomSongs.song;
  }

  async getPlaylists(signal?: AbortSignal): Promise<NavidromePlaylist[]> {
    const data = await this.getJson("getPlaylists", {}, PlaylistsResponseSchema, signal);
    return data.playlists.playlist;
  }

  async getPlaylistSongs(playlistId: string, signal?: AbortSignal): Promise<NavidromeSong[]> {
    const data = await this.getJson(
      "getPlaylist",
      { id: playlistId },
      PlaylistResponseSchema,
      signal
    );
    return data.playlist.entry;
  }

  // -- Binary ---------------------------------------------------------------

  /** Cover art URL, safe to drop straight into `<img src>`. */
  coverArtUrl(coverArtId: string, size = 96): string {
    return this.url("getCoverArt", { id: coverArtId, size });
  }

  /**
   * Downloads a whole track as bytes, ready for `decodeAudioData`.
   *
   * `format=raw` asks Navidrome to skip transcoding so playback and onset
   * analysis see byte-identical samples and no encoder delay enters the
   * timing chain. `estimateContentLength` is off by default, which is fine —
   * we read the body to completion.
   *
   * A **failed** `stream` request returns HTTP 200 with
   * `content-type: application/xml`, so the content-type check below is
   * load-bearing: without it an error document reaches the audio decoder and
   * surfaces as an opaque `EncodingError`.
   */
  async fetchTrackBytes(
    subsonicId: string,
    opts: {
      /** Ask for a transcode instead of raw bytes (codec fallback). */
      format?: "raw" | "mp3";
      signal?: AbortSignal;
      onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
    } = {}
  ): Promise<ArrayBuffer> {
    const url = this.url("stream", {
      id: subsonicId,
      format: opts.format ?? "raw",
    });

    let res: Response;
    try {
      res = await fetch(url, { ...(opts.signal ? { signal: opts.signal } : {}) });
    } catch (e) {
      throw new NavidromeError(
        `Download failed: ${e instanceof Error ? e.message : String(e)}`,
        "network"
      );
    }
    if (!res.ok) {
      throw new NavidromeError(`Download failed: HTTP ${res.status}`, "server");
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (/xml|json|text\/html/i.test(contentType)) {
      // The body is a Subsonic error document, not audio.
      const message = await extractSubsonicError(res);
      throw new NavidromeError(message, "content-type");
    }

    const total = Number(res.headers.get("content-length") ?? "") || null;

    // Stream so download progress is reportable; fall back when the body is
    // not a readable stream (older webviews).
    if (!res.body || !opts.onProgress) {
      const buf = await res.arrayBuffer();
      opts.onProgress?.(buf.byteLength, total);
      return buf;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        opts.onProgress(received, total);
      }
    }

    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out.buffer;
  }

  /**
   * Records a play. `stream` explicitly does not count plays, so without this
   * the game would never register in the server's history. Best-effort.
   */
  async scrobble(subsonicId: string): Promise<void> {
    try {
      await this.getJson(
        "scrobble",
        { id: subsonicId, submission: "true" },
        z.object({}).passthrough()
      );
    } catch {
      // Never let play-count bookkeeping break gameplay.
    }
  }
}

/** Best-effort message out of a Subsonic error document (XML or JSON). */
async function extractSubsonicError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const xml = /message="([^"]*)"/.exec(text);
    if (xml?.[1]) return xml[1];
    const json = /"message"\s*:\s*"([^"]*)"/.exec(text);
    if (json?.[1]) return json[1];
  } catch {
    /* fall through */
  }
  return "Music server refused the stream request";
}

// ---------------------------------------------------------------------------
// Helpers shared by the library UI
// ---------------------------------------------------------------------------

/** Subsonic reports seconds; the game works in ms everywhere. */
export function songDurationMs(song: NavidromeSong): number {
  return Math.round((song.duration ?? 0) * 1000);
}

export function isTrackTooLong(song: NavidromeSong): boolean {
  const ms = songDurationMs(song);
  return ms > 0 && ms > SERVER_MAX_TRACK_MS;
}

export function formatDuration(totalMs: number): string {
  const totalSec = Math.max(0, Math.round(totalMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
