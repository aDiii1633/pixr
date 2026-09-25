import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module + CLI-spawning code must stay server-side and unbundled.
  serverExternalPackages: ["better-sqlite3", "@langchain/langgraph-checkpoint-sqlite"],
  // The Swytchcode kernel is a spawned binary + local bundles: ship them with the API functions.
  outputFileTracingIncludes: { "/api/**": ["./node_modules/swytchcode-cli-linux-x64/**", "./.swytchcode/**"] },
};

export default nextConfig;
