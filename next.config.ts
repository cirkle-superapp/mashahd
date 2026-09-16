import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Enable React StrictMode to catch effect bugs, deprecated APIs, and
  // double-invoked effects in development. (UI audit flagged this was off.)
  reactStrictMode: true,
};

export default nextConfig;
