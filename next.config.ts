import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/projects/*/preview": ["./node_modules/gsap/dist/gsap.min.js", "./node_modules/@fontsource/*/files/*.woff2"],
  },
};

export default nextConfig;
