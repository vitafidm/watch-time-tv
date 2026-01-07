// next.config.ts
import type { NextConfig } from "next";

const NAS_ORIGIN = process.env.NEXT_PUBLIC_NAS_ORIGIN || "https://bendersass.home";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "placehold.co", pathname: "/**" },
      { protocol: "https", hostname: "picsum.photos", pathname: "/**" },
      { protocol: "https", hostname: "image.tmdb.org", pathname: "/t/p/**" },
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
      { protocol: "https", hostname: "img.youtube.com", pathname: "/vi/**" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com", pathname: "/**" },
      { protocol: "https", hostname: "theposterdb.com", pathname: "/**" },
    ],
  },

  async rewrites() {
    return [
      // 1) Session priming (client posts to /pc-hls/session)
      { source: "/pc-hls/session", destination: `${NAS_ORIGIN}/session` },

      // 2) (Optional) health passthrough
      { source: "/pc-hls/health", destination: `${NAS_ORIGIN}/health` },

      // 3) Warmup already includes /hls in the path; just pass through
      { source: "/pc-hls/hls/:path*", destination: `${NAS_ORIGIN}/hls/:path*` },

      // 4) Playlists/segments from signed URL do NOT include /hls -> inject it here
      { source: "/pc-hls/:mediaId/:rest*", destination: `${NAS_ORIGIN}/hls/:mediaId/:rest*` },
    ];
  },
};

export default nextConfig;
