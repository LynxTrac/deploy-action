'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { processTrigger } = require('../src/core');

// Fake reporter recording every platform-sink call (the seam both entries adapt to).
function makeReporter() {
  const state = { info: [], warning: [], outputs: {}, secrets: [], failed: null };
  const reporter = {
    info: (m) => state.info.push(m),
    warning: (m) => state.warning.push(m),
    setOutput: (name, value) => {
      state.outputs[name] = value;
    },
    setSecret: (v) => state.secrets.push(v),
    setFailed: (m) => {
      state.failed = m;
    },
  };
  return { reporter, state };
}

const validInputs = {
  apikey: 'apikey-1234',
  triggerEnvironment: 'beta',
  blueprint: 'web-prod',
  version: '2.5.0',
  artifactsRaw: '{"app":"https://ci/app.zip"}',
};

test('processTrigger: masks the key, maps outputs, returns ok on success', async () => {
  const { reporter, state } = makeReporter();
  const result = await processTrigger(
    validInputs,
    reporter,
    async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ status: 'CREATED', release_id: 12, release_status: 'APPROVED', created: { tasks: 2, files: 3 }, slots: { app: 'https://ci/app.zip' } }),
    }),
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 201);
  assert.ok(state.secrets.includes('apikey-1234'));
  assert.strictEqual(state.outputs['release-id'], '12');
  assert.strictEqual(state.outputs['status'], 'CREATED');
  assert.strictEqual(state.outputs['created'], JSON.stringify({ tasks: 2, files: 3 }));
  assert.strictEqual(state.failed, null);
  assert.ok(state.info.some((l) => /LynxTrac Deploy/.test(l)));
});

test('processTrigger: non-2xx reports a typed failure and returns ok:false', async () => {
  const { reporter, state } = makeReporter();
  const result = await processTrigger(
    validInputs,
    reporter,
    async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ code: 'UNKNOWN_SLOT', message: 'bad' }) }),
  );
  assert.strictEqual(result.ok, false);
  assert.match(state.failed, /UNKNOWN_SLOT/);
  assert.match(state.failed, /422/);
});

test('processTrigger: validation error propagates to the caller (no reporter.setFailed)', async () => {
  const { reporter, state } = makeReporter();
  let fetched = false;
  await assert.rejects(
    () =>
      processTrigger({ apikey: 'short' }, reporter, async () => {
        fetched = true;
        return { ok: true, status: 200, text: async () => '{}' };
      }),
    /apikey is required/,
  );
  assert.strictEqual(fetched, false, 'must not hit the network on a validation error');
  assert.strictEqual(state.failed, null, 'unexpected throws are surfaced by the entry, not core');
});
