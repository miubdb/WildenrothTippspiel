import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // This app is a standalone project that happens to live in a subdirectory
  // of the sibling Tippspiel repo's checkout (see README). Pin the workspace
  // root explicitly so Turbopack doesn't get confused by that repo's
  // package-lock.json one level up.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
