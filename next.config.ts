import type { NextConfig } from "next";

// Conservative browser hardening that does not alter application, auth, or API logic.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

// A CSP is intentionally deferred until it can be tested against Next.js,
// NextAuth, and the inbox UI; an unvalidated policy could break working flows.

export default nextConfig;
