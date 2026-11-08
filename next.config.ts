import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This folder is the project root even when a parent folder has its own lockfile.
  outputFileTracingRoot: root,
  turbopack: { root },
  // HyperFrames, Puppeteer and sharp run only in the worker; keep them out of route bundles.
  serverExternalPackages: ["hyperframes", "puppeteer-core", "sharp"],
  async headers() {
    return [{
      // Site films and posters never change in place (new cuts get new names), so browsers and
      // proxies may keep them for a year.
      source: "/films/:file*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }, {
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
