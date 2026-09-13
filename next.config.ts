import type { NextConfig } from "next";

// Every external connection the app actually makes today (verified before
// writing this): Supabase (REST/Auth/Storage — no Realtime subscriptions
// exist in the code, verified via grep for `.channel(`), the app's own
// service worker (public/sw.js, same-origin) for Web Push, and local
// images/fonts only — no third-party fonts, analytics, or embeds anywhere
// in the repo. Scoped as *.supabase.co (not one hardcoded project ref) so
// this doesn't silently drift if the project host ever changes.
const SUPABASE_CONNECT = "https://*.supabase.co wss://*.supabase.co";

// Full policy is shipped Report-Only for now — collects real violation
// reports (visible in each browser's devtools console; no report-uri
// collector is wired up yet) without risking breaking the live app on a
// directive this pass couldn't fully verify (e.g. any inline script Next's
// own runtime needs). Promote to enforced once reports come back clean.
// frame-ancestors is enforced directly below instead — narrow, safe on its
// own (this app is never legitimately framed), and doesn't depend on
// anything unverified.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE_CONNECT.replace('wss://*.supabase.co', '').trim()}`,
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE_CONNECT}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // Nothing in the app uses any of these — deny by default.
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          // Clickjacking protection — the app is never legitimately framed.
          // X-Frame-Options for older browsers, CSP frame-ancestors (the
          // modern, standard mechanism) enforced alongside the Report-Only
          // policy below.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
          // Vercel always serves this app over HTTPS in production — no
          // `preload` (that's a separate, hard-to-reverse commitment to the
          // browser preload list, out of scope for this pass).
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ]
  },
};

export default nextConfig;
