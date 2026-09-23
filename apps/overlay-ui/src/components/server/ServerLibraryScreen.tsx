import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PAGE_SIZE,
  formatDuration,
  isTrackTooLong,
  songDurationMs,
  type NavidromeAlbum,
  type NavidromeArtist,
  type NavidromeClient,
  type NavidromeSong,
} from "../../lib/navidrome/client.js";
import { useNavidromeAuth } from "../../hooks/useNavidromeAuth.js";
import { NavidromeLoginForm } from "./NavidromeLoginForm.js";

/**
 * Music-server library browser for `phase === "idle"` when
 * `settings.musicSource === "server"`.
 *
 * A drill-down stack in local React state (Artists → Albums → Songs) plus a
 * Search tab and a Recent tab — no router, matching the repo's conventions. The
 * window is 180 px wide, so everything is a vertical list, never a grid, and
 * rows are ~28 px with 8–10 px text.
 *
 * No virtualization: `LeaderboardPanel` doesn't virtualize either, and
 * drill-down keeps each list short. Album lists paginate at `PAGE_SIZE`.
 */

type Tab = "browse" | "search" | "recent";

type StackNode =
  | { kind: "artists" }
  | { kind: "albums"; artistId: string; label: string }
  | { kind: "songs"; albumId: string; label: string };

type Props = {
  onOpenSettings?: () => void;
  /** Change music source — back to the picker. */
  onChangeSource?: () => void;
  /**
   * Called when the player picks a playable track. The caller owns the
   * fetch → decode → analyse → chart pipeline; this screen only chooses.
   */
  onSelectSong?: (song: NavidromeSong, client: NavidromeClient) => void;
};

export function ServerLibraryScreen({
  onOpenSettings,
  onChangeSource,
  onSelectSong,
}: Props): React.ReactElement {
  const auth = useNavidromeAuth();

  if (auth.status === "checking") {
    return <Centered>Connecting…</Centered>;
  }

  // `error` means a stored credential could not be verified (server down,
  // offline). It is kept so Retry can work once the network comes back — so
  // check it *before* falling through to the login form.
  if (auth.status === "error") {
    return (
      <Centered>
        <div style={{ color: "#ff7c7c", marginBottom: 6 }}>
          {auth.error ?? "Cannot reach music server"}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <SmallButton onClick={auth.retry}>Retry</SmallButton>
          <SmallButton onClick={auth.logout}>Sign out</SmallButton>
        </div>
      </Centered>
    );
  }

  if (auth.status === "logged-out" || !auth.client) {
    return (
      <NavidromeLoginForm
        busy={auth.busy}
        error={auth.error}
        onSubmit={(url, user, pass) => void auth.login(url, user, pass)}
        onBack={() => onChangeSource?.()}
      />
    );
  }

  return (
    <LibraryBrowser
      client={auth.client}
      onSignOut={auth.logout}
      {...(onOpenSettings ? { onOpenSettings } : {})}
      {...(onChangeSource ? { onChangeSource } : {})}
      {...(onSelectSong ? { onSelectSong } : {})}
    />
  );
}

// ---------------------------------------------------------------------------

function LibraryBrowser({
  client,
  onSignOut,
  onOpenSettings,
  onChangeSource,
  onSelectSong,
}: {
  client: NavidromeClient;
  onSignOut: () => void;
} & Props): React.ReactElement {
  const [tab, setTab] = useState<Tab>("browse");
  const [stack, setStack] = useState<StackNode[]>([{ kind: "artists" }]);

  const node = stack[stack.length - 1]!;
  const push = useCallback((n: StackNode) => setStack((s) => [...s, n]), []);
  const pop = useCallback(
    () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    []
  );

  const selectAlbum = useCallback(
    (album: NavidromeAlbum) => {
      setTab("browse");
      push({ kind: "songs", albumId: album.id, label: album.name });
    },
    [push]
  );
  const selectArtist = useCallback(
    (artist: NavidromeArtist) => {
      setTab("browse");
      push({ kind: "albums", artistId: artist.id, label: artist.name });
    },
    [push]
  );

  const crumb =
    tab === "browse"
      ? node.kind === "artists"
        ? "Artists"
        : node.label
      : tab === "search"
        ? "Search"
        : "Recent";

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        padding: "6px 8px 8px",
        gap: "4px",
      }}
    >
      <div
        role="tablist"
        style={{
          flexShrink: 0,
          display: "flex",
          borderBottom: "1px solid rgba(60,60,70,0.5)",
        }}
      >
        {(["browse", "search", "recent"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="sh-lib-tab"
            onClick={() => setTab(t)}
          >
            {t === "browse" ? "Browse" : t === "search" ? "Search" : "Recent"}
          </button>
        ))}
      </div>

      <div
        className="thin-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: "1px",
        }}
      >
        {tab === "browse" && (
          <BrowsePane
            client={client}
            node={node}
            onSelectArtist={selectArtist}
            onSelectAlbum={selectAlbum}
            {...(onSelectSong ? { onSelectSong } : {})}
          />
        )}
        {tab === "search" && (
          <SearchPane
            client={client}
            onSelectArtist={selectArtist}
            onSelectAlbum={selectAlbum}
            {...(onSelectSong ? { onSelectSong } : {})}
          />
        )}
        {tab === "recent" && (
          <RecentPane client={client} onSelectAlbum={selectAlbum} />
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "4px",
          paddingTop: "5px",
          borderTop: "1px solid rgba(60,60,70,0.5)",
        }}
      >
        {tab === "browse" && stack.length > 1 && (
          <SmallButton onClick={pop}>‹</SmallButton>
        )}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "8px",
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={crumb}
        >
          {crumb}
        </div>
        {onOpenSettings && <SmallButton onClick={onOpenSettings}>⚙</SmallButton>}
        <SmallButton
          onClick={() => {
            onSignOut();
            onChangeSource?.();
          }}
          title="Sign out of the music server"
        >
          ⏏
        </SmallButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

/** One row of whichever level of the drill-down stack is showing. */
type BrowseRow = NavidromeArtist | NavidromeAlbum | NavidromeSong;

function BrowsePane({
  client,
  node,
  onSelectArtist,
  onSelectAlbum,
  onSelectSong,
}: {
  client: NavidromeClient;
  node: StackNode;
  onSelectArtist: (a: NavidromeArtist) => void;
  onSelectAlbum: (a: NavidromeAlbum) => void;
  onSelectSong?: (s: NavidromeSong, c: NavidromeClient) => void;
}): React.ReactElement {
  // Key the fetch on the node identity so drilling down refetches cleanly.
  const key =
    node.kind === "artists"
      ? "artists"
      : node.kind === "albums"
        ? `albums:${node.artistId}`
        : `songs:${node.albumId}`;

  // Annotated: without it `useAsync` infers T from the first branch only, and
  // the per-kind casts below stop overlapping it.
  const load = useCallback(
    (signal: AbortSignal): Promise<BrowseRow[]> => {
      if (node.kind === "artists") return client.getArtists(signal);
      if (node.kind === "albums")
        return client.getArtistAlbums(node.artistId, signal);
      return client.getAlbumSongs(node.albumId, signal);
    },
    // `key` captures every field `load` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, key]
  );

  const { data, error, loading } = useAsync(load, key);

  if (loading) return <Hint>Loading…</Hint>;
  if (error) return <Hint error>{error}</Hint>;
  if (!data || data.length === 0) return <Hint>Nothing here.</Hint>;

  if (node.kind === "artists") {
    return (
      <>
        {(data as NavidromeArtist[]).map((a) => (
          <ArtistRow key={a.id} artist={a} onClick={() => onSelectArtist(a)} />
        ))}
      </>
    );
  }
  if (node.kind === "albums") {
    return (
      <>
        {(data as NavidromeAlbum[]).map((a) => (
          <AlbumRow
            key={a.id}
            client={client}
            album={a}
            onClick={() => onSelectAlbum(a)}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {(data as NavidromeSong[]).map((s) => (
        <SongRow
          key={s.id}
          song={s}
          onClick={() => onSelectSong?.(s, client)}
        />
      ))}
    </>
  );
}

const SEARCH_DEBOUNCE_MS = 250;

function SearchPane({
  client,
  onSelectArtist,
  onSelectAlbum,
  onSelectSong,
}: {
  client: NavidromeClient;
  onSelectArtist: (a: NavidromeArtist) => void;
  onSelectAlbum: (a: NavidromeAlbum) => void;
  onSelectSong?: (s: NavidromeSong, c: NavidromeClient) => void;
}): React.ReactElement {
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(raw.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [raw]);

  const load = useCallback(
    (signal: AbortSignal) =>
      query.length === 0
        ? Promise.resolve(null)
        : client.search(query, {}, signal),
    [client, query]
  );
  const { data, error, loading } = useAsync(load, query);

  return (
    <>
      <div style={{ flexShrink: 0, paddingBottom: "3px" }}>
        <input
          className="sh-lib-input"
          type="search"
          placeholder="Search library…"
          value={raw}
          spellCheck={false}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>
      {query.length === 0 && <Hint>Type to search artists, albums, songs.</Hint>}
      {query.length > 0 && loading && <Hint>Searching…</Hint>}
      {error && <Hint error>{error}</Hint>}
      {data && (
        <>
          {data.songs.length === 0 &&
            data.albums.length === 0 &&
            data.artists.length === 0 && <Hint>No matches.</Hint>}
          {data.songs.length > 0 && <GroupLabel>Songs</GroupLabel>}
          {data.songs.map((s) => (
            <SongRow
              key={s.id}
              song={s}
              onClick={() => onSelectSong?.(s, client)}
            />
          ))}
          {data.albums.length > 0 && <GroupLabel>Albums</GroupLabel>}
          {data.albums.map((a) => (
            <AlbumRow
              key={a.id}
              client={client}
              album={a}
              onClick={() => onSelectAlbum(a)}
            />
          ))}
          {data.artists.length > 0 && <GroupLabel>Artists</GroupLabel>}
          {data.artists.map((a) => (
            <ArtistRow key={a.id} artist={a} onClick={() => onSelectArtist(a)} />
          ))}
        </>
      )}
    </>
  );
}

function RecentPane({
  client,
  onSelectAlbum,
}: {
  client: NavidromeClient;
  onSelectAlbum: (a: NavidromeAlbum) => void;
}): React.ReactElement {
  const [albums, setAlbums] = useState<NavidromeAlbum[]>([]);
  const [offset, setOffset] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedUpTo = useRef(-1);

  useEffect(() => {
    if (loadedUpTo.current === offset) return;
    loadedUpTo.current = offset;
    const ac = new AbortController();
    setLoading(true);
    client
      .getAlbumList("newest", { size: PAGE_SIZE, offset }, ac.signal)
      .then((page) => {
        if (ac.signal.aborted) return;
        setAlbums((prev) => (offset === 0 ? page : [...prev, ...page]));
        setDone(page.length < PAGE_SIZE);
        setError(null);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [client, offset]);

  return (
    <>
      {albums.map((a) => (
        <AlbumRow
          key={a.id}
          client={client}
          album={a}
          onClick={() => onSelectAlbum(a)}
        />
      ))}
      {loading && <Hint>Loading…</Hint>}
      {error && <Hint error>{error}</Hint>}
      {!loading && !error && albums.length === 0 && <Hint>Nothing here.</Hint>}
      {!loading && !done && albums.length > 0 && (
        <button
          type="button"
          className="sh-lib-row"
          onClick={() => setOffset(albums.length)}
        >
          <span className="sh-lib-row-sub">…load more</span>
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const THUMB = 24;

function CoverThumb({
  client,
  coverArt,
}: {
  client: NavidromeClient;
  coverArt: string | undefined;
}): React.ReactElement {
  const src = coverArt ? coverArtUrl(client, coverArt) : null;
  return (
    <span
      style={{
        flex: `0 0 ${THUMB}px`,
        width: THUMB,
        height: THUMB,
        borderRadius: 3,
        overflow: "hidden",
        background: "#1a1a22",
        display: "block",
      }}
    >
      {src && (
        <img
          src={src}
          alt=""
          width={THUMB}
          height={THUMB}
          loading="lazy"
          style={{ width: THUMB, height: THUMB, objectFit: "cover", display: "block" }}
          onError={(e) => {
            // A missing cover returns an error document; hide rather than show
            // a broken-image glyph.
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      )}
    </span>
  );
}

/**
 * Cover-art URLs are stable per id, so memoize them: building one runs a
 * `URL` + `searchParams` dance, and these rows re-render on every keystroke in
 * the search box. The browser HTTP cache handles the bytes.
 */
const coverUrlCache = new Map<string, string>();
function coverArtUrl(client: NavidromeClient, coverArt: string): string {
  const key = `${client.serverUrl}|${coverArt}`;
  let url = coverUrlCache.get(key);
  if (url === undefined) {
    url = client.coverArtUrl(coverArt, THUMB * 2);
    coverUrlCache.set(key, url);
  }
  return url;
}

function ArtistRow({
  artist,
  onClick,
}: {
  artist: NavidromeArtist;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button type="button" className="sh-lib-row" onClick={onClick}>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="sh-lib-row-title" style={{ display: "block" }}>
          {artist.name}
        </span>
        {artist.albumCount !== undefined && (
          <span className="sh-lib-row-sub" style={{ display: "block" }}>
            {artist.albumCount} album{artist.albumCount === 1 ? "" : "s"}
          </span>
        )}
      </span>
      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>›</span>
    </button>
  );
}

function AlbumRow({
  client,
  album,
  onClick,
}: {
  client: NavidromeClient;
  album: NavidromeAlbum;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button type="button" className="sh-lib-row" onClick={onClick}>
      <CoverThumb client={client} coverArt={album.coverArt} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="sh-lib-row-title" style={{ display: "block" }}>
          {album.name}
        </span>
        <span className="sh-lib-row-sub" style={{ display: "block" }}>
          {album.artist ?? "Unknown artist"}
          {album.year !== undefined ? ` · ${album.year}` : ""}
        </span>
      </span>
      <span style={{ fontSize: 9, color: "var(--text-muted)" }}>›</span>
    </button>
  );
}

function SongRow({
  song,
  onClick,
}: {
  song: NavidromeSong;
  onClick: () => void;
}): React.ReactElement {
  const tooLong = isTrackTooLong(song);
  const durationMs = songDurationMs(song);
  return (
    <button
      type="button"
      className="sh-lib-row"
      disabled={tooLong}
      onClick={onClick}
      title={tooLong ? "Too long to analyze" : song.title}
    >
      <span
        style={{
          flex: "0 0 14px",
          fontSize: 8,
          color: "var(--text-muted)",
          textAlign: "right",
        }}
      >
        {song.track ?? ""}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="sh-lib-row-title" style={{ display: "block" }}>
          {song.title}
        </span>
        <span className="sh-lib-row-sub" style={{ display: "block" }}>
          {tooLong
            ? "too long to analyze"
            : `${song.artist ?? ""}${song.artist && durationMs ? " · " : ""}${
                durationMs ? formatDuration(durationMs) : ""
              }`}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

/**
 * Minimal fetch-on-key helper. `key` identifies the request; when it changes the
 * in-flight request is aborted and its result discarded, so drilling down fast
 * can never paint a stale list.
 */
function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string
): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });

  useEffect(() => {
    const ac = new AbortController();
    setState({ data: null, error: null, loading: true });
    load(ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        setState({ data, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState({
          data: null,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        });
      });
    return () => ac.abort();
    // `key` is the identity of the request; `load` is rebuilt alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

function Hint({
  children,
  error,
}: {
  children: React.ReactNode;
  error?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        fontSize: "8px",
        color: error ? "#ff7c7c" : "var(--text-muted)",
        lineHeight: 1.4,
        padding: "6px 4px",
      }}
    >
      {children}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        fontSize: "7.5px",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.35)",
        padding: "5px 4px 2px",
      }}
    >
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        padding: "10px",
        fontSize: "9px",
        color: "var(--text-muted)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(title ? { title } : {})}
      style={{
        flex: "0 0 auto",
        padding: "3px 6px",
        fontSize: "9px",
        borderRadius: "4px",
        border: "1px solid #333",
        background: "#1c1c24",
        color: "var(--text-muted)",
        cursor: "pointer",
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}
