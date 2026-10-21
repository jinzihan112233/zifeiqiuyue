import { withPayload } from '@payloadcms/next/withPayload';

export default withPayload({
  poweredByHeader: false,
  distDir: process.env.APP_ENV === 'production' ? '.next-production' : '.next',
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'self'" },
        ...(process.env.APP_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
      ] },
      { source: '/:path(login|register|recover|account|account/.*|workspace|workspace/.*)', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
});
