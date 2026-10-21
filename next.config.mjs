import { withPayload } from '@payloadcms/next/withPayload';

export default withPayload({
  poweredByHeader: false,
  serverExternalPackages: ['pg'],
  async headers() {
    return [{ source: '/:path(login|register|recover|account|account/.*|workspace|workspace/.*)', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] }];
  },
});
