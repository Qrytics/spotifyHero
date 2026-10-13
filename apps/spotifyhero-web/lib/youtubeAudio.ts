import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { Innertube } from "youtubei.js";

/**
 * YouTube link → mp3, server-side. The browser then decodes that mp3 and runs it through the
 * same onset analysis + chart generator as the desktop app's "My Library" mode.
 *
 * Resolution goes through youtubei.js (InnerTube). Clients are tried in order because YouTube
 * gates them differently and changes which one works; as of writing the IOS client returns a
 * direct, unsigned audio URL where WEB/ANDROID/TV need a PO token. The audio is fetched in
 * ranged chunks — googlevideo throttles single unranged requests — and transcoded with ffmpeg.
 *
 * Nothing is stored: the mp3 exists only in this request's memory and the response.
 */

const CLIENTS = ["IOS", "MWEB", "WEB_EMBEDDED", "TV"] as const;
const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_DURATION_S = 9 * 60;
/**
 * Vercel caps a function response at ~4.5 MB, so the bitrate is sized to the song: 128 kbps
 * for anything up to ~4 minutes, scaling down to 64 kbps at the 9-minute limit.
 */
const RESPONSE_BUDGET_BYTES = 4.2 * 1024 * 1024;

export class YoutubeAudioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "YoutubeAudioError";
  }
}

let innertube: Promise<Innertube> | null = null;
/** `fresh` drops the cached session: YouTube's bot check is tied partly to the visitor session. */
function client(fresh = false): Promise<Innertube> {
  if (fresh) innertube = null;
  innertube ??= Innertube.create({ generate_session_locally: true }).catch((e) => {
    innertube = null;
    throw e;
  });
  return innertube;
}

/**
 * Fresh sessions to try. Measured on Vercel (2026-10-13): YouTube's bot check is mostly tied to the
 * data-centre address, not the session — 4 fresh sessions got 1 song in 8 through — so retrying
 * more only delays the same error. A second try still rescues the occasional one-off 403.
 */
const ATTEMPTS = 2;
const isBotCheck = (msg: string) => /not a bot|sign in to confirm|LOGIN_REQUIRED/i.test(msg);

export type ResolvedAudio = {
  videoId: string;
  title: string;
  author: string;
  durationS: number;
  url: string;
  contentLength: number;
};

export async function resolveAudio(videoId: string, fresh = false): Promise<ResolvedAudio> {
  const yt = await client(fresh);
  let lastError = "no client could resolve this video";
  for (const name of CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client: name });
      const status = info.playability_status?.status;
      if (status && status !== "OK") {
        lastError = info.playability_status?.reason ?? `video is ${status.toLowerCase()}`;
        continue;
      }
      const durationS = info.basic_info.duration ?? 0;
      if (info.basic_info.is_live) throw new YoutubeAudioError("Live streams can't be charted.", 422);
      if (durationS > MAX_DURATION_S)
        throw new YoutubeAudioError(`That video is over ${MAX_DURATION_S / 60} minutes — pick a single song.`, 422);
      const format = info.chooseFormat({ type: "audio", quality: "best" });
      const url = format.url ?? (await format.decipher(yt.session.player));
      if (!url) continue;
      return {
        videoId,
        title: info.basic_info.title ?? `YouTube ${videoId}`,
        author: info.basic_info.author ?? "",
        durationS,
        url,
        contentLength: Number(format.content_length ?? 0),
      };
    } catch (e) {
      if (e instanceof YoutubeAudioError) throw e;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new YoutubeAudioError(`Couldn't get audio from YouTube: ${lastError}`, 502);
}

async function download(audio: ResolvedAudio): Promise<Buffer> {
  const parts: Buffer[] = [];
  const total = audio.contentLength;
  if (!total) {
    const res = await fetch(audio.url);
    if (!res.ok) throw new YoutubeAudioError(`YouTube refused the audio stream (${res.status}).`, 502);
    return Buffer.from(await res.arrayBuffer());
  }
  for (let start = 0; start < total; start += CHUNK_BYTES) {
    const end = Math.min(total, start + CHUNK_BYTES) - 1;
    const res = await fetch(audio.url, { headers: { range: `bytes=${start}-${end}` } });
    if (res.status !== 206 && res.status !== 200)
      throw new YoutubeAudioError(`YouTube refused the audio stream (${res.status}).`, 502);
    parts.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(parts);
}

function toMp3(input: Buffer, durationS: number): Promise<Buffer> {
  if (!ffmpegPath) return Promise.reject(new YoutubeAudioError("ffmpeg is unavailable on this server.", 500));
  const kbps = Math.max(64, Math.min(128, Math.floor((RESPONSE_BUDGET_BYTES * 8) / Math.max(durationS, 1) / 1000)));
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath as string, [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-vn", "-ac", "2", "-ar", "44100", "-b:a", `${kbps}k`,
      "-f", "mp3", "pipe:1",
    ]);
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", (e) => reject(new YoutubeAudioError(`ffmpeg failed to start: ${e.message}`, 500)));
    p.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new YoutubeAudioError(`Couldn't convert the audio: ${err.trim().slice(0, 200)}`, 500)),
    );
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
}

/**
 * Resolve + download, retried with a fresh session when YouTube answers with its bot check or
 * refuses the stream (a 403 on the media URL). Real errors — private, too long, live — fail fast.
 */
export async function youtubeToMp3(videoId: string): Promise<{ mp3: Buffer; meta: ResolvedAudio }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const meta = await resolveAudio(videoId, attempt > 0);
      const source = await download(meta);
      const mp3 = await toMp3(source, meta.durationS);
      return { mp3, meta };
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = isBotCheck(msg) || /refused the audio stream \((403|429)\)/.test(msg);
      if (!retryable) throw e;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : "";
  throw new YoutubeAudioError(
    isBotCheck(msg)
      ? "YouTube is asking this server to prove it isn't a bot right now. Try again in a minute, or try another song."
      : msg || "Couldn't get audio from YouTube.",
    502,
  );
}
