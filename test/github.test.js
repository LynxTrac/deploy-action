'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../src/github');

// Minimal @actions/core stand-in that records what the action did.
function makeCore(inputs) {
  const state = { outputs: {}, failed: null, secrets: [], warnings: [] };
  const api = {
    getInput: (name) => inputs[name] ?? '',
    setSecret: (v) => state.secrets.push(v),
    setOutput: (name, v) => {
      state.outputs[name] = v;
    },
    setFailed: (m) => {
      state.failed = m;
    },
    warning: (w) => state.warnings.push(w),
    info: () => {},
  };
  return { api, state };
}

// fetch stand-in returning a fixed JSON response.
const fakeFetch = (bodyObj, status) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(bodyObj),
});

const baseInputs = {
  apikey: 'apikey-1234',
  blueprint: 'web-prod',
  version: '2.5.0',
  artifacts: '{"app":"https://ci.example.com/app.zip"}',
};

test('run: maps a 201 CREATED response to outputs and masks the key', async () => {
  const { api, state } = makeCore(baseInputs);
  await run({
    coreApi: api,
    fetchApi: fakeFetch(
      {
        status: 'CREATED',
        release_id: 99,
        release_status: 'APPROVED',
        created: { tasks: 1, files: 1 },
        slots: { app: 'https://ci.example.com/app.zip' },
      },
      201,
    ),
  });

  assert.strictEqual(state.failed, null);
  assert.strictEqual(state.outputs['release-id'], '99');
  assert.strictEqual(state.outputs['status'], 'CREATED');
  assert.strictEqual(state.outputs['release-status'], 'APPROVED');
  assert.strictEqual(state.outputs['created'], JSON.stringify({ tasks: 1, files: 1 }));
  assert.ok(state.secrets.includes('apikey-1234'));
});

test('run: fails the step on a non-2xx and surfaces the backend code', async () => {
  const { api, state } = makeCore(baseInputs);
  await run({
    coreApi: api,
    fetchApi: fakeFetch({ status: 'VALIDATION_FAILED', code: 'MISSING_SLOT', message: 'Missing required artifact slot: app' }, 422),
  });

  assert.ok(state.failed, 'expected setFailed to be called');
  assert.match(state.failed, /MISSING_SLOT/);
  assert.match(state.failed, /422/);
});

test('run: a build/validation error fails the step (no network call)', async () => {
  const { api, state } = makeCore({ apikey: 'short' }); // invalid apikey -> buildRequest throws
  let fetched = false;
  await run({
    coreApi: api,
    fetchApi: async () => {
      fetched = true;
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  assert.strictEqual(fetched, false);
  assert.match(state.failed, /apikey is required/);
});

test('run: reads snake_case inputs (release_name, deploy_manifest) and sends them', async () => {
  const { api, state } = makeCore({
    apikey: 'apikey-1234',
    blueprint: 'web-prod',
    version: '2.5.0',
    artifacts: '{"app":"https://ci/app.zip"}',
    release_name: 'Web 2.5.0',
  });
  let sentBody = null;
  await run({
    coreApi: api,
    fetchApi: async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { ok: true, status: 201, text: async () => JSON.stringify({ status: 'CREATED', release_id: 1 }) };
    },
  });
  assert.strictEqual(state.failed, null);
  assert.strictEqual(sentBody.release_name, 'Web 2.5.0');
  assert.strictEqual(sentBody.source, 'github', 'sends the CI provider for provenance (LT-9308)');
});
