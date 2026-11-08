import { join } from "node:path";
import type { NextConfig } from "next";

const root = join(import.meta.dirname, "..", "..");

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@ato/core", "@ato/sdk"],
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
};

export default config;
