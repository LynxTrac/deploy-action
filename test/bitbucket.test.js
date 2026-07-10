'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../src/bitbucket');

// Records what the Bitbucket entry logged / how it exited.
function makeHarness(env) {
  const state = { logs: [], warns: [], errors: [], exitCode: null, fetched: false, sent: null };
  const logger = {
    log: (m) => state.logs.push(m),
    warn: (m) => state.warns.push(m),
    error: (m) => state.errors.push(m),
  };
  const exit = (code) => {
    state.exitCode = code;
  };
  return { env, logger, exit, state };
}

const okFetch = (bodyObj, status = 201) => async (url, opts) => {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(bodyObj),
    _url: url,
    _opts: opts,
  };
};

test('bitbucket: reads env vars, posts, and succeeds without setting an exit code', async () => {
  const { env, logger, exit, state } = makeHarness({
    APIKEY: 'apikey-1234',
    TRIGGER_ENVIRONMENT: 'beta',
    BLUEPRINT: 'web-prod',
    VERSION: '2.5.0',
    ARTIFACTS: '{"app":"https://ci/app.zip"}',
  });
  let sent = null;
  await run({
    env,
    logger,
    exit,
    fetchApi: async (url, opts) => {
      sent = { url, body: JSON.parse(opts.body) };
      return { ok: true, status: 201, text: async () => JSON.stringify({ status: 'CREATED', release_id: 42, release_status: 'APPROVED', created: { tasks: 1, files: 1 } }) };
    },
  });

  assert.strictEqual(state.exitCode, null, 'success must not set a failing exit code');
  assert.strictEqual(state.errors.length, 0);
  assert.strictEqual(sent.url, 'https://beta.lynxtrac.com/api/external/deploy/release');
  assert.strictEqual(sent.body.blueprint, 'web-prod');
  assert.strictEqual(sent.body.source, 'bitbucket', 'sends the CI provider for provenance (LT-9308)');
  assert.ok(state.logs.some((l) => /LynxTrac Deploy/.test(l)), 'prints the detailed summary');
});

test('bitbucket: non-2xx sets exit code 1 and surfaces the backend code', async () => {
  const { env, logger, exit, state } = makeHarness({
    APIKEY: 'apikey-1234',
    BLUEPRINT: 'web-prod',
    VERSION: '2.5.0',
    ARTIFACTS: '{}',
  });
  await run({
    env,
    logger,
    exit,
    fetchApi: okFetch({ status: 'VALIDATION_FAILED', code: 'MISSING_SLOT', message: 'Missing required artifact slot: app' }, 422),
  });
  assert.strictEqual(state.exitCode, 1);
  assert.ok(state.errors.some((e) => /MISSING_SLOT/.test(e) && /422/.test(e)));
});

test('bitbucket: a validation error sets exit code 1 without a network call', async () => {
  const { env, logger, exit, state } = makeHarness({ APIKEY: 'short' });
  let fetched = false;
  await run({
    env,
    logger,
    exit,
    fetchApi: async () => {
      fetched = true;
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  assert.strictEqual(fetched, false);
  assert.strictEqual(state.exitCode, 1);
  assert.ok(state.errors.some((e) => /apikey is required/.test(e)));
});

test('bitbucket: full host URL as TRIGGER_ENVIRONMENT is used directly (Task 9)', async () => {
  const { env, logger, exit } = makeHarness({
    APIKEY: 'apikey-1234',
    TRIGGER_ENVIRONMENT: 'https://haunted-angela-attractingly.ngrok-free.dev',
    BLUEPRINT: 'web-prod',
    VERSION: '1.0.0',
    ARTIFACTS: '{}',
  });
  let sentUrl = null;
  await run({
    env,
    logger,
    exit,
    fetchApi: async (url) => {
      sentUrl = url;
      return { ok: true, status: 201, text: async () => JSON.stringify({ status: 'CREATED', release_id: 7 }) };
    },
  });
  assert.strictEqual(sentUrl, 'https://haunted-angela-attractingly.ngrok-free.dev/api/external/deploy/release');
});

test('bitbucket: EVERYTHING via DEPLOY_MANIFEST env, commit/branch from BITBUCKET_*', async () => {
  const { env, logger, exit } = makeHarness({
    APIKEY: 'apikey-1234',
    DEPLOY_MANIFEST: JSON.stringify({
      blueprint: 'web-prod',
      version: '4.2.1',
      artifacts: { 'app-bundle': 'https://ci/app.zip' },
      release: { name: 'Web 4.2.1', description: 'manifest build' },
    }),
    BITBUCKET_COMMIT: 'abc1234',
    BITBUCKET_BRANCH: 'release/4.2.1',
  });
  let body = null;
  await run({
    env,
    logger,
    exit,
    fetchApi: async (_url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 201, text: async () => JSON.stringify({ status: 'CREATED', release_id: 9 }) };
    },
  });
  assert.strictEqual(body.blueprint, 'web-prod');
  assert.strictEqual(body.version, '4.2.1');
  assert.strictEqual(body.release_name, 'Web 4.2.1');
  assert.strictEqual(body.commit, 'abc1234');
  assert.strictEqual(body.branch, 'release/4.2.1');
});
