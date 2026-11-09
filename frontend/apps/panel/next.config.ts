import os from "node:os";
import path from "node:path";
import { config } from "@repo/next-config";
import type { NextConfig } from "next";

// Next loads next.config.ts as CommonJS, so __dirname is defined here. The
// fallback covers the ESM case. Pinning the root stops Turbopack inferring it
// from a stray lockfile higher up the filesystem.
const monorepoRoot =
  // biome-ignore lint/correctness/noGlobalDirnameFilename: CommonJS config context
  typeof __dirname === "undefined"
    ? path.resolve(process.cwd(), "../..")
    : // biome-ignore lint/correctness/noGlobalDirnameFilename: CommonJS config context
      path.resolve(__dirname, "../..");

/**
 * Teammates open the dev server by this machine's LAN address. Next blocks
 * dev-asset requests from origins it does not know, so every local IPv4
 * address and the Bonjour name are allowed. Production builds are unaffected.
 */
const lanAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter(
    (i): i is os.NetworkInterfaceInfo =>
      !!i && i.family === "IPv4" && !i.internal
  )
  .map((i) => i.address);

const nextConfig: NextConfig = {
  ...config,
  // The panel ships no PostHog, so drop the ingest rewrites next-forge adds.
  rewrites: undefined,
  turbopack: { root: monorepoRoot },
  allowedDevOrigins: [...lanAddresses, "*.local", "localhost"],
};

export default nextConfig;
