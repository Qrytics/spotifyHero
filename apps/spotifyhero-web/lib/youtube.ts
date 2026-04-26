const YT_REGEX =
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;

export function parseYouTubeId(url: string): string | null {
  const match = url.match(YT_REGEX);
  return match?.[1] ?? null;
}

export function sanitizeTitle(videoId: string): string {
  return `YouTube ${videoId}`;
}
