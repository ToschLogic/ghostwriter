import type { NextConfig } from "next";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_GHOSTWRITER_API_BASE_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["ghostwriter.local"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_BASE_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
