'use strict';

/**
 * INTERNAL E2E HARNESS — maintainer-only. Not part of the action's public surface.
 *
 * Minimal stand-in for the LynxTrac backend deploy-trigger endpoint, so the action can be
 * exercised end-to-end locally (action -> backend) without a live server. Mirrors the real
 * contract: POST /api/external/deploy/release, Api-Key auth, structured JSON response.
 */
const http = require('node:http');

const port = Number(process.argv[2] || 8799);

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/external/deploy/release') {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ message: 'not found' }));
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Api-Key ')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'VENDOR_UNRESOLVED', message: 'missing/invalid API key' }));
    }

    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      res.writeHead(422, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'VALIDATION_FAILED', code: 'INVALID_ARTIFACTS', message: 'bad JSON' }));
    }

    // eslint-disable-next-line no-console
    console.error(`[mock-backend] trigger blueprint=${payload.blueprint} version=${payload.version}`);

    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'CREATED',
        release_id: 12345,
        version: payload.version,
        release_status: 'APPROVED', // auto-approved; configured rollout (if any) triggered
        created: { tasks: 1, files: Object.keys(payload.artifacts || {}).length },
        rollout: { triggered: true },
        slots: payload.artifacts || {},
      }),
    );
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.error(`[mock-backend] listening on http://127.0.0.1:${port}`);
});
