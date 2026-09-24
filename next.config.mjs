/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb"
    },
    // Tell Next.js not to bundle argon2 with webpack — keep it as a
    // real require() so its native .node binaries stay next to it.
    serverComponentsExternalPackages: ["argon2"],
    // Force Vercel's output file tracer to include the native argon2
    // prebuilds explicitly. Without this, the tracer can miss them
    // because argon2 picks the right .node file at runtime (dynamic
    // require), which static tracing can't follow.
    outputFileTracingIncludes: {
      "/api/**/*": ["./node_modules/argon2/prebuilds/**/*"]
    }
  },
  images: {
    remotePatterns: []
  }
};

export default nextConfig;
