import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't write a generated AGENTS.md into the app during `next dev`.
  agentRules: false,
  // The compute dashboard is the homepage; keep old /compute links working.
  async redirects() {
    return [{ source: "/compute", destination: "/", permanent: true }];
  },
};

export default nextConfig;
