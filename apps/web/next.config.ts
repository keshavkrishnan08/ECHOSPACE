import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@echospace/engine", "@echospace/schemas"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  turbopack: { root: path.join(import.meta.dirname, "../..") },
  poweredByHeader: false,
  agentRules: false,
};

export default config;
