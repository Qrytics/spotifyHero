import type {
  ChallengePayload,
  Difficulty,
  GameSession,
  Leaderboard,
  LeaderboardEntry,
} from "@spotifyhero/shared-types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LeaderboardClient {
  /** Fetch the top-N leaderboard for a track+difficulty. */
  getLeaderboard(
    trackId: string,
    difficulty: Difficulty,
    limit?: number
  ): Promise<Leaderboard>;
  getFriendLeaderboard(
    trackId: string,
    difficulty: Difficulty,
    friendUserIds: readonly string[],
    limit?: number
  ): Promise<Leaderboard>;
  /** Optional — implemented by `SupabaseLeaderboardClient` when `spotify_user_id` exists in DB. */
  getFriendLeaderboardForSpotifyUsers?(
    trackId: string,
    difficulty: Difficulty,
    spotifyUserIds: readonly string[],
    limit?: number
  ): Promise<Leaderboard>;

  /** Submit a completed game session. */
  submitScore(session: GameSession): Promise<void>;

  /** Build a shareable challenge link from a completed session. */
  buildChallenge(session: GameSession, track: {
    id: string;
    name: string;
  }): ChallengePayload;

  /** Share challenge to clipboard / system share. */
  shareChallenge(payload: ChallengePayload): Promise<void>;
}

// ---------------------------------------------------------------------------
// Supabase-backed implementation (HTTP only – no SDK dep at this layer)
// ---------------------------------------------------------------------------

export interface SupabaseClientConfig {
  url: string;
  anonKey: string;
  playerName?: string;
  accessToken?: string;
  userId?: string;
  /** Spotify user id (`GET /v1/me`) — stored on `leaderboard_entries.spotify_user_id`. */
  spotifyUserId?: string;
}

export class SupabaseLeaderboardClient implements LeaderboardClient {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;
  private readonly playerName: string;
  private readonly accessToken: string | undefined;
  private readonly userId: string | undefined;
  private readonly spotifyUserId: string | undefined;

  constructor(config: SupabaseClientConfig) {
    this.baseUrl = config.url;
    this.playerName = config.playerName ?? "Anonymous";
    this.headers = {
      "Content-Type": "application/json",
      apikey: config.anonKey,
      Authorization: `Bearer ${config.accessToken ?? config.anonKey}`,
    };
    this.accessToken = config.accessToken;
    this.userId = config.userId;
    this.spotifyUserId = config.spotifyUserId;
  }

  async getLeaderboard(
    trackId: string,
    difficulty: Difficulty,
    limit = 50
  ): Promise<Leaderboard> {
    const params = new URLSearchParams({
      track_id: `eq.${trackId}`,
      difficulty: `eq.${difficulty}`,
      order: "score.desc",
      limit: String(limit),
    });

    const res = await fetch(
      `${this.baseUrl}/rest/v1/leaderboard_entries?${params}`,
      { headers: this.headers }
    );

    if (!res.ok) {
      throw new Error(`Leaderboard fetch failed: ${res.status}`);
    }

    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const entries: LeaderboardEntry[] = rows.map((row, i) => ({
      rank: i + 1,
      playerName: String(row["player_name"] ?? "Anonymous"),
      score: Number(row["score"] ?? 0),
      accuracy: Number(row["accuracy"] ?? 0),
      maxCombo: Number(row["max_combo"] ?? 0),
      playedAt: new Date(String(row["played_at"])),
      sessionId: String(row["session_id"]),
    }));

    return {
      trackId,
      difficulty,
      entries,
      fetchedAt: new Date(),
    };
  }

  async getFriendLeaderboard(
    trackId: string,
    difficulty: Difficulty,
    friendUserIds: readonly string[],
    limit = 50
  ): Promise<Leaderboard> {
    if (friendUserIds.length === 0) {
      return { trackId, difficulty, entries: [], fetchedAt: new Date() };
    }
    const params = new URLSearchParams({
      track_id: `eq.${trackId}`,
      difficulty: `eq.${difficulty}`,
      user_id: `in.(${friendUserIds.map((x) => `"${x}"`).join(",")})`,
      order: "score.desc",
      limit: String(limit),
    });
    const res = await fetch(
      `${this.baseUrl}/rest/v1/leaderboard_entries?${params}`,
      { headers: this.headers }
    );
    if (!res.ok) {
      throw new Error(`Friend leaderboard fetch failed: ${res.status}`);
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const entries: LeaderboardEntry[] = rows.map((row, i) => ({
      rank: i + 1,
      playerName: String(row["player_name"] ?? "Anonymous"),
      score: Number(row["score"] ?? 0),
      accuracy: Number(row["accuracy"] ?? 0),
      maxCombo: Number(row["max_combo"] ?? 0),
      playedAt: new Date(String(row["played_at"])),
      sessionId: String(row["session_id"]),
    }));
    return { trackId, difficulty, entries, fetchedAt: new Date() };
  }

  /** Friend scope = Spotify user IDs you follow (`user-follow-read`). Requires `spotify_user_id` column. */
  async getFriendLeaderboardForSpotifyUsers(
    trackId: string,
    difficulty: Difficulty,
    spotifyUserIds: readonly string[],
    limit = 50
  ): Promise<Leaderboard> {
    if (spotifyUserIds.length === 0) {
      return { trackId, difficulty, entries: [], fetchedAt: new Date() };
    }
    const params = new URLSearchParams({
      track_id: `eq.${trackId}`,
      difficulty: `eq.${difficulty}`,
      spotify_user_id: `in.(${spotifyUserIds.map((x) => `"${x}"`).join(",")})`,
      order: "score.desc",
      limit: String(limit),
    });
    const res = await fetch(
      `${this.baseUrl}/rest/v1/leaderboard_entries?${params}`,
      { headers: this.headers }
    );
    if (!res.ok) {
      throw new Error(`Spotify-friends leaderboard fetch failed: ${res.status}`);
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const entries: LeaderboardEntry[] = rows.map((row, i) => ({
      rank: i + 1,
      playerName: String(row["player_name"] ?? "Anonymous"),
      score: Number(row["score"] ?? 0),
      accuracy: Number(row["accuracy"] ?? 0),
      maxCombo: Number(row["max_combo"] ?? 0),
      playedAt: new Date(String(row["played_at"])),
      sessionId: String(row["session_id"]),
    }));
    return { trackId, difficulty, entries, fetchedAt: new Date() };
  }

  async submitScore(session: GameSession): Promise<void> {
    const body: Record<string, unknown> = {
      session_id: session.id,
      track_id: session.trackId,
      difficulty: session.difficulty,
      score: session.score,
      max_combo: session.maxCombo,
      accuracy: session.accuracy,
      played_at: session.playedAt.toISOString(),
      player_name: session.playerName ?? this.playerName,
      judgements: session.judgements,
      user_id: this.userId ?? null,
    };
    if (this.spotifyUserId) {
      body.spotify_user_id = this.spotifyUserId;
    }

    const res = await fetch(`${this.baseUrl}/rest/v1/leaderboard_entries`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Score submission failed: ${res.status}`);
    }
  }

  buildChallenge(
    session: GameSession,
    track: { id: string; name: string }
  ): ChallengePayload {
    const scoreStr = encodeURIComponent(session.score);
    const trackStr = encodeURIComponent(track.id);
    const diffStr = encodeURIComponent(session.difficulty);

    // shareUrl points to the web leaderboard filtered to this song
    const shareUrl = `${this.baseUrl}/challenge?track=${trackStr}&diff=${diffStr}&score=${scoreStr}&session=${session.id}`;

    return {
      challengerId: session.id,
      challengerName: session.playerName ?? this.playerName,
      trackId: track.id,
      trackName: track.name,
      difficulty: session.difficulty,
      score: session.score,
      accuracy: session.accuracy,
      shareUrl,
    };
  }

  async shareChallenge(payload: ChallengePayload): Promise<void> {
    // In the Tauri shell this delegates to Rust clipboard/share APIs.
    // In a browser context we use the Web Share API with a clipboard fallback.
    const text = `🎵 Beat my score of ${payload.score.toLocaleString()} on "${payload.trackName}" (${payload.difficulty}) in spotifyHero!\n${payload.shareUrl}`;

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      await navigator.share({ title: "spotifyHero Challenge", text, url: payload.shareUrl });
    } else if (
      typeof navigator !== "undefined" &&
      navigator.clipboard
    ) {
      await navigator.clipboard.writeText(text);
    } else {
      console.log("[LeaderboardClient] Share text:", text);
    }
  }
}

// ---------------------------------------------------------------------------
// No-op client (offline / demo mode)
// ---------------------------------------------------------------------------

export class OfflineLeaderboardClient implements LeaderboardClient {
  private store: GameSession[] = [];

  async getLeaderboard(
    trackId: string,
    difficulty: Difficulty
  ): Promise<Leaderboard> {
    const entries: LeaderboardEntry[] = this.store
      .filter((s) => s.trackId === trackId && s.difficulty === difficulty)
      .sort((a, b) => b.score - a.score)
      .map((s, i) => ({
        rank: i + 1,
        playerName: s.playerName ?? "You",
        score: s.score,
        accuracy: s.accuracy,
        maxCombo: s.maxCombo,
        playedAt: s.playedAt,
        sessionId: s.id,
      }));

    return { trackId, difficulty, entries, fetchedAt: new Date() };
  }

  async getFriendLeaderboard(
    trackId: string,
    difficulty: Difficulty,
    _friendUserIds: readonly string[],
    _limit?: number
  ): Promise<Leaderboard> {
    return this.getLeaderboard(trackId, difficulty);
  }

  async getFriendLeaderboardForSpotifyUsers(
    trackId: string,
    difficulty: Difficulty,
    _spotifyUserIds: readonly string[],
    _limit?: number
  ): Promise<Leaderboard> {
    return { trackId, difficulty, entries: [], fetchedAt: new Date() };
  }

  async submitScore(session: GameSession): Promise<void> {
    this.store.push(session);
  }

  buildChallenge(
    session: GameSession,
    track: { id: string; name: string }
  ): ChallengePayload {
    return {
      challengerId: session.id,
      challengerName: session.playerName ?? "You",
      trackId: track.id,
      trackName: track.name,
      difficulty: session.difficulty,
      score: session.score,
      accuracy: session.accuracy,
      shareUrl: `https://spotifyhero.itch.io?track=${track.id}`,
    };
  }

  async shareChallenge(payload: ChallengePayload): Promise<void> {
    console.log(
      `[Offline] Challenge: ${payload.challengerName} scored ${payload.score} on ${payload.trackName}`
    );
  }
}
