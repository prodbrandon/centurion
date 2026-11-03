import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Repo root, so Turbopack can compile the shared packages/core and packages/attribution sources.
  turbopack: { root: path.join(__dirname, "../..") },
  transpilePackages: ["@centurion/core"]
};

export default nextConfig;
