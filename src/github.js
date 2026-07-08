'use strict';

const core = require('@actions/core');
const { processTrigger } = require('./core');
const { assertSupportedNode } = require('./node-version');

/**
 * LT-8787 / LT-9216 — GitHub Actions entry point for the LynxTrac deploy action.
 *
 * Reads `with:` inputs via @actions/core, adapts @actions/core into the shared `reporter`, then
 * delegates to the common processing unit (core.js). The Bitbucket entry (bitbucket.js) shares that
 * same processing unit, so both providers behave identically and emit the same detailed summary.
 *
 * `coreApi` and `fetchApi` are injectable so this can be unit-tested without a runner.
 */
async function run({ coreApi = core, fetchApi = fetch } = {}) {
  try {
    const inputs = {
      apikey: coreApi.getInput('apikey', { required: true }),
      triggerEnvironment: coreApi.getInput('trigger_environment'),
      blueprint: coreApi.getInput('blueprint'),
      version: coreApi.getInput('version'),
      artifactsRaw: coreApi.getInput('artifacts'),
      releaseName: coreApi.getInput('release_name'),
      description: coreApi.getInput('description'),
      deployManifestRaw: coreApi.getInput('deploy_manifest'),
      commit: coreApi.getInput('commit') || process.env.GITHUB_SHA || '',
      branch: coreApi.getInput('branch') || process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || '',
    };

    const reporter = {
      info: (message) => coreApi.info(message),
      warning: (message) => coreApi.warning(message),
      setOutput: (name, value) => coreApi.setOutput(name, value),
      setSecret: (value) => coreApi.setSecret(value),
      setFailed: (message) => coreApi.setFailed(message),
    };

    await processTrigger(inputs, reporter, fetchApi);
  } catch (err) {
    // Input-reading errors (e.g. a missing required apikey) and validation/network throws land here.
    coreApi.setFailed(err.message);
  }
}

// Only auto-run when invoked directly (so the function can be unit-tested without firing).
// GitHub pins the runtime to node20 via action.yml, so this always passes there; the gate is kept
// for parity and defence, and must precede run() (see node-version.js / bitbucket.js for why).
if (require.main === module) {
  if (assertSupportedNode()) {
    run();
  }
}

module.exports = { run };
