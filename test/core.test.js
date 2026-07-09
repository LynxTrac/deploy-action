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
      text: async () =>
        JSON.stringify({ status: 'CREATED', release_id: 12, release_code: 'LR12', release_name: 'Web 2.5.0', release_status: 'APPROVED', created: { tasks: 2, files: 3 }, slots: { app: 'https://ci/app.zip' } }),
    }),
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 201);
  assert.ok(state.secrets.includes('apikey-1234'));
  assert.strictEqual(state.outputs['release-id'], '12'); // machine output kept for back-compat
  assert.strictEqual(state.outputs['release-code'], 'LR12'); // LT-9310
  assert.strictEqual(state.outputs['release-name'], 'Web 2.5.0');
  assert.strictEqual(state.outputs['status'], 'CREATED');
  assert.strictEqual(state.outputs['created'], JSON.stringify({ tasks: 2, files: 3 }));
  assert.strictEqual(state.failed, null);
  assert.ok(state.info.some((l) => /LynxTrac Deploy/.test(l)));
  // LT-9312 — the pre-request log shows only the base URL, never the deploy API path.
  const triggerLog = state.info.find((l) => /deploy trigger ->/.test(l));
  assert.ok(triggerLog && /https:\/\/beta\.lynxtrac\.com/.test(triggerLog));
  assert.ok(!state.info.some((l) => /\/api\/external\/deploy\/release/.test(l)), 'never logs the API path');
});

test('processTrigger: LT-9312 redacts the API key if a backend error body echoes it', async () => {
  const { reporter, state } = makeReporter();
  await processTrigger(
    validInputs,
    reporter,
    async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ message: 'upstream rejected key apikey-1234 outright' }),
    }),
  );
  assert.ok(state.failed, 'failure surfaced');
  assert.ok(!/apikey-1234/.test(state.failed), 'the API key must not appear in the failure output');
  assert.match(state.failed, /\*\*\*/);
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
