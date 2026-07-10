'use strict';

const { buildRequest, formatDeploySummary, toBaseUrl } = require('./lib');

/**
 * LT-9216 — common processing unit shared by every CI provider entry point.
 *
 * Given already-read `inputs` and a platform `reporter`, this builds + validates the request
 * (lib.js), POSTs to the LynxTrac backend deploy-trigger endpoint, maps the structured response to
 * outputs, and reports the detailed success summary or a typed failure. All platform I/O — how
 * inputs are read, how outputs/secrets/failures are surfaced — lives in the GitHub/Bitbucket entry
 * adapters, so both entries share exactly one code path and produce the same detailed result.
 *
 * This module has NO dependency on @actions/* or process.env: the entry adapter injects `reporter`
 * (the platform sink) and `fetchApi` (the HTTP client). Validation/network errors propagate to the
 * caller (the entry's try/catch); a non-2xx backend response is a handled failure reported here.
 *
 * @param {object}   inputs    Normalized inputs (see buildRequest); triggerEnvironment feeds the summary banner.
 * @param {object}   reporter  { info, warning, setOutput, setSecret, setFailed } platform sink.
 * @param {Function} fetchApi  fetch implementation (injectable for tests; defaults to global fetch).
 * @returns {Promise<{ ok: boolean, status: number, data: object }>} result for programmatic callers/tests.
 */
async function processTrigger(inputs, reporter, fetchApi = fetch) {
  // Defense-in-depth: scrub the API key from logs even if it is echoed back in a backend error body.
  // (No-op on providers without a masking API — the action never prints the key itself.)
  if (inputs.apikey) {
    reporter.setSecret(inputs.apikey);
  }

  const { url, headers, body, warnings } = buildRequest(inputs);
  warnings.forEach((w) => reporter.warning(w));

  // LT-9312 — never print the deploy API path; the base URL (scheme+host) is the most that is shown.
  const baseUrl = toBaseUrl(url);
  // LT-9312 — redact the API key from any surfaced backend text (defence for providers without a
  // log-masking API, e.g. Bitbucket, should a backend error body ever reflect the key).
  const redactKey = (value) => (value && inputs.apikey ? String(value).split(inputs.apikey).join('***') : value);

  reporter.info(`LynxTrac deploy trigger -> ${baseUrl} (blueprint=${body.blueprint}, version=${body.version})`);

  const response = await fetchApi(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  // Map the structured response to outputs. Providers without an output mechanism (Bitbucket) use a
  // no-op setOutput, so this is safe to call unconditionally.
  if (data.release_id !== undefined && data.release_id !== null) {
    reporter.setOutput('release-id', String(data.release_id));
  }
  if (data.status) {
    reporter.setOutput('status', data.status);
  }
  if (data.release_status) {
    reporter.setOutput('release-status', data.release_status);
  }
  if (data.created) {
    reporter.setOutput('created', JSON.stringify(data.created));
  }
  if (data.slots) {
    reporter.setOutput('slots', JSON.stringify(data.slots));
  }
  // LT-9310 — friendly release identifiers as machine outputs (the DB id output is kept for back-compat).
  if (data.release_code) {
    reporter.setOutput('release-code', data.release_code);
  }
  if (data.release_name) {
    reporter.setOutput('release-name', data.release_name);
  }

  if (!response.ok) {
    const code = data.code ? ` [${data.code}]` : '';
    reporter.setFailed(
      `LynxTrac deploy failed (HTTP ${response.status})${code}: ${redactKey(data.message) || redactKey(text) || 'no body'}`,
    );
    return { ok: false, status: response.status, data };
  }

  // Detailed, multi-line success summary: blueprint/version banner, per-task/file breakdown,
  // resolved/omitted/extra slots, and rollout status — identical for GitHub and Bitbucket.
  reporter.info(formatDeploySummary(data, { url: baseUrl, environment: inputs.triggerEnvironment }));
  return { ok: true, status: response.status, data };
}

module.exports = { processTrigger };
