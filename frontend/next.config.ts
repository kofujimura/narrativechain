import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['35.202.52.156'],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
