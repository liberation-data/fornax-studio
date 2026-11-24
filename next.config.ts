import type { NextConfig } from 'next'

// Standalone, so the same build runs from `npm start` and inside Electron. Traced from this directory, so server.js
// lands at .next/standalone/server.js wherever the checkout sits.
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  // The proxy streams the backend's server-sent events as they come; compressing would hold them back.
  compress: false,
}

export default config
