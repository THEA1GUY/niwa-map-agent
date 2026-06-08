import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder so a stray lockfile elsewhere
  // (e.g. in the home directory) doesn't get picked as the root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
