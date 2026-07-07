'use strict';

const core = require('@actions/core');
const { buildRequest, formatDeploySummary } = require('./lib');

/**
 * LT-8787 — LynxTrac deploy action entry point.
 *
 * Reads inputs, builds the request (validation in lib.js), POSTs to the LynxTrac backend
 * deploy-trigger endpoint, maps the structured response to action outputs, and fails the
 * step on any non-2xx with the backend's stable error code surfaced to the workflow log.
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
      releaseName: coreApi.getInput('release-name'),
      description: coreApi.getInput('description'),
      deployModalRaw: coreApi.getInput('deploy-modal'),
      commit: coreApi.getInput('commit') || process.env.GITHUB_SHA || '',
      branch: coreApi.getInput('branch') || process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || '',
    };

    // Defense-in-depth: scrub the API key from logs even if it was passed as a plain input or
    // echoed back in a backend error body.
    if (inputs.apikey) {
      coreApi.setSecret(inputs.apikey);
    }

    const { url, headers, body, warnings } = buildRequest(inputs);
    warnings.forEach((w) => coreApi.warning(w));

    coreApi.info(`LynxTrac deploy trigger -> ${url} (blueprint=${body.blueprint}, version=${body.version})`);

    const response = await fetchApi(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await response.text();

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (data.release_id !== undefined && data.release_id !== null) {
      coreApi.setOutput('release-id', String(data.release_id));
    }
    if (data.status) {
      coreApi.setOutput('status', data.status);
    }
    if (data.release_status) {
      coreApi.setOutput('release-status', data.release_status);
    }
    if (data.created) {
      coreApi.setOutput('created', JSON.stringify(data.created));
    }
    if (data.slots) {
      coreApi.setOutput('slots', JSON.stringify(data.slots));
    }

    if (!response.ok) {
      const code = data.code ? ` [${data.code}]` : '';
      coreApi.setFailed(`LynxTrac deploy failed (HTTP ${response.status})${code}: ${data.message || text || 'no body'}`);
      return;
    }

    // Detailed, multi-line success summary (Task 7): blueprint/version banner, per-task/file
    // breakdown, resolved/omitted/extra slots, and rollout status.
    coreApi.info(formatDeploySummary(data, { url, environment: inputs.triggerEnvironment }));
  } catch (err) {
    coreApi.setFailed(err.message);
  }
}

// Only auto-run when invoked directly (so the function can be unit-tested without firing).
if (require.main === module) {
  run();
}

module.exports = { run };
