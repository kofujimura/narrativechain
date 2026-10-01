import type { NextConfig } from "next";
import path from 'node:path';

// HTTP tests build a source-only copy under .next-http-tests/<uuid>.
const testRun = process.env.NARRATIVE_HTTP_TEST_RUN;
if (testRun && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(testRun)) {
  throw new Error('Invalid HTTP test run identifier');
}

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }]
  },
  turbopack: {
    // Shared node_modules symlink must stay inside Turbopack's workspace root.
    root: testRun ? path.resolve(__dirname, '../..') : __dirname,
  },
};

export default nextConfig;
