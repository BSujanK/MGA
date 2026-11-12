import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Same-origin API: the browser talks to /api/*, Next proxies to the backend.
  // That keeps the session cookie first-party (no CORS, no third-party cookie rules).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.MGA_API_URL ?? "http://localhost:8000"}/:path*` }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
