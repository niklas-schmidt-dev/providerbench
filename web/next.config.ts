import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Benchmark data lives outside web/ at the repo root; allow importing it.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
