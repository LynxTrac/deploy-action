#!/usr/bin/env node
'use strict';

const { processTrigger } = require('./core');
const { assertSupportedNode } = require('./node-version');

/**
 * LT-9216 — Bitbucket Pipelines entry point for the LynxTrac deploy action.
 *
 * Installed via `npm install git+https://github.com/LynxTrac/deploy-action.git` and invoked as
 * `npx lynxtrac-deploy` (see package.json `bin`). Bitbucket has no `with:` inputs mechanism, so
 * inputs arrive as environment variables (set as Repository/Deployment variables in Bitbucket):
 *
 *   APIKEY, TRIGGER_ENVIRONMENT, BLUEPRINT, VERSION, ARTIFACTS,
 *   RELEASE_NAME, DESCRIPTION, DEPLOY_MANIFEST
 *
 * Commit/branch provenance auto-fill from Bitbucket's built-in BITBUCKET_COMMIT / BITBUCKET_BRANCH.
 *
 * Bitbucket has no action-output or log-masking API, so the reporter's setOutput/setSecret are
 * no-ops; failures set process.exitCode = 1 so the pipeline step fails. All request building,
 * validation, POST, and the detailed summary come from the shared processing unit (core.js), so the
 * Bitbucket result is identical to the GitHub one.
 *
 * `env`, `fetchApi`, `logger`, and `exit` are injectable so this can be unit-tested without a runner.
 */
async function run({
  env = process.env,
  fetchApi = fetch,
  logger = console,
  exit = (code) => {
    process.exitCode = code;
  },
} = {}) {
  const reporter = {
    info: (message) => logger.log(message),
    warning: (message) => logger.warn(message),
    setOutput: () => {}, // Bitbucket Pipelines has no step-output mechanism.
    setSecret: () => {}, // No log-masking API; the action never prints the key itself.
    setFailed: (message) => {
      logger.error(message);
      exit(1);
    },
  };

  try {
    const inputs = {
      apikey: env.APIKEY || '',
      triggerEnvironment: env.TRIGGER_ENVIRONMENT || '',
      blueprint: env.BLUEPRINT || '',
      version: env.VERSION || '',
      artifactsRaw: env.ARTIFACTS || '',
      releaseName: env.RELEASE_NAME || '',
      description: env.DESCRIPTION || '',
      deployManifestRaw: env.DEPLOY_MANIFEST || '',
      commit: env.COMMIT || env.BITBUCKET_COMMIT || '',
      branch: env.BRANCH || env.BITBUCKET_BRANCH || '',
    };

    await processTrigger(inputs, reporter, fetchApi);
  } catch (err) {
    reporter.setFailed(err.message);
  }
}

// Only auto-run when invoked directly (so the function can be unit-tested without firing).
// Gate on the Node version BEFORE calling run(): run()'s `fetchApi = fetch` default is evaluated on
// invocation and would throw "fetch is not defined" on Node < 18 before any guard inside run() could.
if (require.main === module) {
  if (assertSupportedNode()) {
    run();
  }
}

module.exports = { run };
