'use strict';

const core = require('@actions/core');
const { buildRequest } = require('./lib');

/**
 * LT-8787 — LynxTrac deploy action entry point.
 *
 * Reads inputs, builds the request (validation in lib.js), POSTs to the LynxTrac backend
 * deploy-trigger endpoint, maps the structured response to action outputs, and fails the
 * step on any non-2xx with the backend's stable error code surfaced to the workflow log.
 */
async function run() {
  try {
    const inputs = {
      apikey: core.getInput('apikey', { required: true }),
      lynxserver: core.getInput('lynxserver'),
      blueprint: core.getInput('blueprint'),
      version: core.getInput('version'),
      artifactsRaw: core.getInput('artifacts'),
      releaseName: core.getInput('release-name'),
      description: core.getInput('description'),
      deployModalRaw: core.getInput('deploy-modal'),
      commit: core.getInput('commit') || process.env.GITHUB_SHA || '',
      branch: core.getInput('branch') || process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || '',
    };

    const { url, headers, body, warnings } = buildRequest(inputs);
    warnings.forEach((w) => core.warning(w));

    core.info(`LynxTrac deploy trigger -> ${url} (blueprint=${body.blueprint}, version=${body.version})`);

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await response.text();

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (data.release_id !== undefined && data.release_id !== null) {
      core.setOutput('release-id', String(data.release_id));
    }
    if (data.status) {
      core.setOutput('status', data.status);
    }
    if (data.release_status) {
      core.setOutput('release-status', data.release_status);
    }
    if (data.created) {
      core.setOutput('created', JSON.stringify(data.created));
    }
    if (data.slots) {
      core.setOutput('slots', JSON.stringify(data.slots));
    }

    if (!response.ok) {
      const code = data.code ? ` [${data.code}]` : '';
      core.setFailed(`LynxTrac deploy failed (HTTP ${response.status})${code}: ${data.message || text || 'no body'}`);
      return;
    }

    core.info(
      `LynxTrac deploy ${data.status || 'OK'}: release ${data.release_id ?? '?'} ` +
        `(status=${data.release_status || '-'}, created=${JSON.stringify(data.created || {})}).`,
    );
  } catch (err) {
    core.setFailed(err.message);
  }
}

run();
