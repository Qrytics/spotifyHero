import { describe, it, expect, vi, afterEach } from "vitest";
import {
  NavidromeClient,
  NavidromeError,
  formatDuration,
  isTrackTooLong,
  songDurationMs,
  toGameTrackId,
  toSubsonicId,
  SERVER_MAX_TRACK_MS,
} from "./client.js";
import { normalizeServerUrl } from "./credentials.js";
import type { NavidromeCredentials } from "./credentials.js";

const CREDS: NavidromeCredentials = {
  serverUrl: "https://music.example.com",
  username: "gamer",
  salt: "0123456789abcdef",
  token: "26719a1196d2a940705a59634eb18eab",
};

function client() {
  return new NavidromeClient(CREDS);
}

/** Subsonic wraps every JSON payload in `subsonic-response`. */
function ok(body: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      "subsonic-response": { status: "ok", version: "1.16.1", type: "navidrome", ...body },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function failed(code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      "subsonic-response": { status: "failed", version: "1.16.1", error: { code, message } },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function stubFetch(impl: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input))));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("url()", () => {
  it("carries the full classic-auth query on every request", () => {
    const u = new URL(client().url("getArtists"));
    expect(u.pathname).toBe("/rest/getArtists");
    expect(u.searchParams.get("u")).toBe("gamer");
    expect(u.searchParams.get("t")).toBe(CREDS.token);
    expect(u.searchParams.get("s")).toBe(CREDS.salt);
    expect(u.searchParams.get("v")).toBe("1.16.1");
    expect(u.searchParams.get("c")).toBe("spotifyHero");
    expect(u.searchParams.get("f")).toBe("json");
  });

  it("never puts the plaintext password anywhere", () => {
    expect(client().url("stream", { id: "1" })).not.toContain("password");
    expect(client().url("stream", { id: "1" })).not.toContain("&p=");
  });

  it("omits undefined params and encodes the rest", () => {
    const u = new URL(client().url("search3", { query: "a & b", songCount: undefined }));
    expect(u.searchParams.get("query")).toBe("a & b");
    expect(u.searchParams.has("songCount")).toBe(false);
  });

  it("requests raw audio by default from coverArtUrl's sibling endpoints", () => {
    expect(client().coverArtUrl("al-1", 96)).toContain("/rest/getCoverArt");
    expect(new URL(client().coverArtUrl("al-1", 96)).searchParams.get("size")).toBe("96");
  });
});

describe("normalizeServerUrl()", () => {
  it.each([
    ["music.example.com", "https://music.example.com"],
    ["https://music.example.com/", "https://music.example.com"],
    ["https://music.example.com/rest", "https://music.example.com"],
    ["https://music.example.com/app", "https://music.example.com"],
    ["https://music.example.com/app/#/login", "https://music.example.com"],
    ["  http://192.168.1.5:4533  ", "http://192.168.1.5:4533"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------

describe("envelope handling", () => {
  it("treats HTTP 200 + status:failed as an error, not success", async () => {
    stubFetch(() => failed(40, "Wrong username or password"));
    await expect(client().ping()).rejects.toThrow(/Wrong username or password/);
  });

  it("classifies code 40 as auth so the UI can re-prompt for login", async () => {
    stubFetch(() => failed(40, "Wrong username or password"));
    const err = await client()
      .ping()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NavidromeError);
    expect((err as NavidromeError).kind).toBe("auth");
    expect((err as NavidromeError).code).toBe(40);
  });

  it("classifies a missing-parameter error as server, not auth", async () => {
    stubFetch(() => failed(10, "Required parameter is missing"));
    const err = await client()
      .getAlbumSongs("x")
      .catch((e: unknown) => e);
    expect((err as NavidromeError).kind).toBe("server");
  });

  it("reports a network failure distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );
    const err = await client()
      .ping()
      .catch((e: unknown) => e);
    expect((err as NavidromeError).kind).toBe("network");
  });

  it("rejects a body that is not a subsonic envelope", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ hello: "world" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const err = await client()
      .ping()
      .catch((e: unknown) => e);
    expect((err as NavidromeError).kind).toBe("schema");
  });
});

// ---------------------------------------------------------------------------

describe("browse endpoints", () => {
  it("flattens the alphabet index into one artist list", async () => {
    stubFetch(() =>
      ok({
        artists: {
          ignoredArticles: "The",
          index: [
            { name: "A", artist: [{ id: "ar-1", name: "Air", albumCount: 3 }] },
            {
              name: "B",
              artist: [
                { id: "ar-2", name: "Boards of Canada" },
                { id: "ar-3", name: "Burial", coverArt: "ar-3" },
              ],
            },
          ],
        },
      })
    );
    const artists = await client().getArtists();
    expect(artists.map((a) => a.name)).toEqual(["Air", "Boards of Canada", "Burial"]);
    expect(artists[2]?.coverArt).toBe("ar-3");
  });

  it("returns an empty list rather than throwing on an empty library", async () => {
    stubFetch(() => ok({ artists: { ignoredArticles: "" } }));
    await expect(client().getArtists()).resolves.toEqual([]);
  });

  it("tolerates unknown extra fields from newer servers", async () => {
    stubFetch(() =>
      ok({
        album: {
          id: "al-1",
          name: "Geogaddi",
          artist: "Boards of Canada",
          someFutureField: 42,
          song: [
            {
              id: "so-1",
              title: "Ready Lets Go",
              duration: 62,
              bpm: 91,
              anotherFutureField: true,
            },
          ],
        },
      })
    );
    const songs = await client().getAlbumSongs("al-1");
    expect(songs).toHaveLength(1);
    expect(songs[0]?.title).toBe("Ready Lets Go");
    expect(songs[0]?.bpm).toBe(91);
  });

  it("accepts bpm: 0 from untagged files and reports it as unknown", async () => {
    // Navidrome sends 0 for files with no BPM tag. `.positive()` here used to reject
    // the whole album, and passing 0 through would defeat every `bpm ?? 120` reader.
    stubFetch(() =>
      ok({
        album: {
          id: "al-2",
          name: "Minecraft - Volume Alpha",
          artist: "C418",
          song: [
            { id: "so-1", title: "Key", duration: 66, bpm: 0 },
            { id: "so-2", title: "Door", duration: 61, bpm: 0 },
            { id: "so-3", title: "Subwoofer Lullaby", duration: 209, bpm: 92 },
          ],
        },
      })
    );
    const songs = await client().getAlbumSongs("al-2");
    expect(songs).toHaveLength(3);
    expect(songs[0]?.bpm).toBeUndefined();
    expect(songs[1]?.bpm).toBeUndefined();
    expect(songs[2]?.bpm).toBe(92);
  });

  it("defaults each search3 bucket to an empty array", async () => {
    stubFetch(() => ok({ searchResult3: { song: [{ id: "so-9", title: "Hey" }] } }));
    const r = await client().search("hey");
    expect(r.songs).toHaveLength(1);
    expect(r.artists).toEqual([]);
    expect(r.albums).toEqual([]);
  });

  it("passes the album-list type and pagination through", async () => {
    const spy = stubFetch(() => ok({ albumList2: { album: [] } }));
    await client().getAlbumList("newest", { size: 100, offset: 200 });
    const u = new URL(String(spy.mock.calls[0]?.[0]));
    expect(u.searchParams.get("type")).toBe("newest");
    expect(u.searchParams.get("size")).toBe("100");
    expect(u.searchParams.get("offset")).toBe("200");
  });
});

// ---------------------------------------------------------------------------

describe("fetchTrackBytes()", () => {
  it("asks for format=raw so analysis and playback see identical bytes", async () => {
    const spy = stubFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "audio/flac" },
        })
    );
    const buf = await client().fetchTrackBytes("so-1");
    expect(new URL(String(spy.mock.calls[0]?.[0])).searchParams.get("format")).toBe("raw");
    expect(buf.byteLength).toBe(4);
  });

  it("can request an mp3 transcode as a codec fallback", async () => {
    const spy = stubFetch(
      () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        })
    );
    await client().fetchTrackBytes("so-1", { format: "mp3" });
    expect(new URL(String(spy.mock.calls[0]?.[0])).searchParams.get("format")).toBe("mp3");
  });

  it("refuses an XML error document served as HTTP 200 (never feeds the decoder)", async () => {
    stubFetch(
      () =>
        new Response(
          '<?xml version="1.0"?><subsonic-response status="failed"><error code="70" message="Song not found"/></subsonic-response>',
          { status: 200, headers: { "content-type": "application/xml" } }
        )
    );
    const err = await client()
      .fetchTrackBytes("missing")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NavidromeError);
    expect((err as NavidromeError).kind).toBe("content-type");
    expect((err as NavidromeError).message).toBe("Song not found");
  });

  it("surfaces the message from a JSON error document too", async () => {
    stubFetch(() => failed(50, "User is not authorized"));
    const err = await client()
      .fetchTrackBytes("so-1")
      .catch((e: unknown) => e);
    expect((err as NavidromeError).kind).toBe("content-type");
    expect((err as NavidromeError).message).toBe("User is not authorized");
  });

  it("reports download progress and reassembles the stream exactly", async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    stubFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "audio/flac", "content-length": "5" },
        })
    );

    const seen: Array<[number, number | null]> = [];
    const buf = await client().fetchTrackBytes("so-1", {
      onProgress: (received, total) => seen.push([received, total]),
    });

    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([
      [2, 5],
      [5, 5],
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("id namespacing", () => {
  it("round-trips a server id through the nd: prefix", () => {
    const gameId = toGameTrackId("abc123");
    expect(gameId).toBe("nd:abc123");
    expect(toSubsonicId(gameId)).toBe("abc123");
  });

  it("returns null for a Spotify id so server-only paths cannot mistake it", () => {
    expect(toSubsonicId("3n3Ppam7vgaVa1iaRUc9Lp")).toBeNull();
  });
});

describe("duration helpers", () => {
  it("converts Subsonic seconds to ms", () => {
    expect(songDurationMs({ id: "1", title: "t", duration: 245 })).toBe(245_000);
  });

  it("treats a missing duration as 0 and therefore not too long", () => {
    expect(songDurationMs({ id: "1", title: "t" })).toBe(0);
    expect(isTrackTooLong({ id: "1", title: "t" })).toBe(false);
  });

  it("refuses tracks past the analysis cap", () => {
    const cap = SERVER_MAX_TRACK_MS / 1000;
    expect(isTrackTooLong({ id: "1", title: "t", duration: cap })).toBe(false);
    expect(isTrackTooLong({ id: "1", title: "t", duration: cap + 1 })).toBe(true);
  });

  it("formats m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9_000)).toBe("0:09");
    expect(formatDuration(245_000)).toBe("4:05");
    expect(formatDuration(3_600_000)).toBe("60:00");
  });
});
