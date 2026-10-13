import { NextResponse } from "next/server";
import { z } from "zod";
import { parseYouTubeId } from "@/lib/youtube";
import { YoutubeAudioError, youtubeToMp3 } from "@/lib/youtubeAudio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ youtubeUrl: z.string().min(1).max(500) });

/**
 * A crude per-instance limiter: enough to stop one tab hammering the converter, not a quota.
 * Serverless instances don't share memory, so this is per warm instance, not global.
 */
const recent = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 12;

function limited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > MAX_PER_WINDOW;
}

/**
 * POST { youtubeUrl } → the song as audio/mpeg, with its title/author/duration in the
 * `x-sh-meta` header (URI-encoded JSON). The client decodes and charts it; this route only
 * converts. `no-store` keeps the audio out of every cache between here and the player.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const videoId = parsed.success ? parseYouTubeId(parsed.data.youtubeUrl) : null;
  if (!videoId) {
    return NextResponse.json({ error: "That doesn't look like a YouTube video link." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) {
    return NextResponse.json({ error: "Too many songs at once — try again in a few minutes." }, { status: 429 });
  }

  try {
    const { mp3, meta } = await youtubeToMp3(videoId);
    const header = encodeURIComponent(
      JSON.stringify({ videoId, title: meta.title, author: meta.author, durationMs: Math.round(meta.durationS * 1000) }),
    );
    return new Response(new Uint8Array(mp3), {
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(mp3.length),
        "cache-control": "no-store",
        "x-sh-meta": header,
      },
    });
  } catch (e) {
    const status = e instanceof YoutubeAudioError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Conversion failed.";
    console.error("[youtube/audio]", videoId, message);
    return NextResponse.json({ error: message }, { status });
  }
}
