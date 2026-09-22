import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["playwright", "playwright-core"],
  outputFileTracingIncludes: { "/api/schedule/export": ["./public/fonts/xb-niloofar.ttf"] },
};

export default nextConfig;
