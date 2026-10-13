/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/games/spotifyHero",
  experimental: {
    // Both resolve files from their own package directory at runtime (youtubei.js its platform
    // shims, ffmpeg-static its binary), so they must stay real node_modules, not webpack chunks.
    serverComponentsExternalPackages: ["youtubei.js", "ffmpeg-static"],
    // ffmpeg-static's binary is read by path, never imported, so file tracing cannot see it. The
    // glob names pnpm's real store path, not the `node_modules/ffmpeg-static` symlink: including
    // the binary through the symlink makes Vercel's "Deploying outputs" step fail with an
    // unexplained internal error (measured, three times), while the real path deploys cleanly.
    outputFileTracingIncludes: {
      "/api/youtube/audio": ["../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg"],
    },
  },
};

export default nextConfig;
