import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // HyperFrames, Puppeteer and sharp run only in the worker; keep them out of route bundles.
  serverExternalPackages: ["hyperframes", "puppeteer-core", "sharp"],
  async headers() {
    return [{
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
