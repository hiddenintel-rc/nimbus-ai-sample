import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle for the Docker image used by the
  // self-hosted deployment. Vercel ignores this and uses its own packaging.
  output: "standalone",
};

export default nextConfig;
