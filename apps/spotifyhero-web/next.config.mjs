/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/games/spotifyHero",
  output: "standalone",
  experimental: {
    // Both resolve files from their own package directory at runtime (youtubei.js its platform
    // shims, ffmpeg-static its binary), so they must stay real node_modules, not webpack chunks.
    serverComponentsExternalPackages: ["youtubei.js", "ffmpeg-static"],
    // ffmpeg-static's binary is read by path, never imported, so file tracing cannot see it.
    outputFileTracingIncludes: {
      "/api/youtube/audio": ["./node_modules/ffmpeg-static/ffmpeg*"],
    },
  },
};

export default nextConfig;
