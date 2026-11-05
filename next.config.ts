import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Scope Turbopack to this app instead of the unrelated parent lockfile.
  turbopack: {
    root: process.cwd(),
  },
  // Spreadsheet rows are parsed in the browser and sent as JSON through a
  // Server Action. Keep the cap bounded while leaving room for normal imports.
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
