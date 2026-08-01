'use strict';

/**
 * LT-8787 — pure helpers for the LynxTrac deploy action.
 *
 * No network, no @actions/* — so this is unit-testable with `node --test` alone.
 * The action's I/O (reading inputs, the HTTP call, setting outputs) lives in index.js.
 */

// trigger_environment resolution: allowlisted short aliases + a full-URL escape hatch (LT-8787).
// Extend ALIASES as QA spins up named test servers under *.lynxtrac.com.
const SERVER_ALIASES = {
  '': 'https://app.lynxtrac.com', // production default when unspecified
  app: 'https://app.lynxtrac.com',
  beta: 'https://beta.lynxtrac.com',
  qa: 'https://qa.lynxtrac.com',
  local: 'http://localhost:5566', // local backend for dev testing
  dev: 'http://localhost:5566',
};

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Resolve the `trigger_environment` input to a base URL. Allowlist alias OR full http(s) URL. */
function resolveServerUrl(triggerEnvironment) {
  const value = (triggerEnvironment || '').trim();
  if (!value) {
    return SERVER_ALIASES[''];
  }

  if (/^https?:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid trigger_environment URL: ${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`trigger_environment URL must use http(s): ${value}`);
    }
    return value.replace(/\/+$/, '');
  }

  const key = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SERVER_ALIASES, key)) {
    return SERVER_ALIASES[key];
  }

  const allowed = Object.keys(SERVER_ALIASES).filter(Boolean).join(', ');
  throw new Error(`Invalid trigger_environment '${value}'. Use one of: ${allowed}, or a full http(s) URL.`);
}

function isValidApiKey(apiKey) {
  return typeof apiKey === 'string' && apiKey.trim().length >= 8;
}

function isValidVersion(version) {
  return typeof version === 'string' && SEMVER_RE.test(version.trim());
}

/** Parse an optional JSON string input; returns undefined when empty. */
function parseJsonInput(raw, label) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${e.message}`);
  }
}

/** Parse an optional boolean-ish input ('true'/'false'/'1'/'0'/'yes'/'no'); undefined when empty/unknown. */
function parseBoolInput(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return undefined;
  }
  const v = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(v)) {
    return false;
  }
  return undefined; // unrecognized -> treat as unset (backend falls back to the blueprint default)
}

/** Strip a refs/heads|tags/ prefix from a git ref. */
function normalizeRef(ref) {
  if (!ref) {
    return '';
  }
  return String(ref).replace(/^refs\/(?:heads|tags)\//, '');
}

/**
 * Merge named inputs with the deploy_manifest alias object.
 * Named inputs win per field; deploy_manifest fills any gaps.
 */
function mergeInputs(named, manifest) {
  const m = manifest || {};
  const mRelease = m.release || {};
  return {
    blueprint: named.blueprint || m.blueprint || '',
    version: named.version || m.version || '',
    artifacts: named.artifacts !== undefined ? named.artifacts : m.artifacts || {},
    releaseName: named.releaseName || mRelease.name || m.release_name || '',
    description: named.description || mRelease.description || m.description || '',
    // LT-9925 — multi-source (Blueprint Streams) assembly extras.
    segment: named.segment || m.segment || '',
    autoApprove: named.autoApprove !== undefined ? named.autoApprove : m.auto_approve,
  };
}

/**
 * Validate inputs and assemble the backend request.
 * @returns {{ url: string, headers: object, body: object, warnings: string[] }}
 */
function buildRequest(inputs) {
  const { apikey, triggerEnvironment, commit, branch, source } = inputs;
  const warnings = [];

  if (!isValidApiKey(apikey)) {
    throw new Error('apikey is required (minimum 8 characters).');
  }

  const named = {
    blueprint: (inputs.blueprint || '').trim(),
    version: (inputs.version || '').trim(),
    artifacts: parseJsonInput(inputs.artifactsRaw, 'artifacts'),
    releaseName: (inputs.releaseName || '').trim(),
    description: (inputs.description || '').trim(),
    // LT-9925 — multi-source (Blueprint Streams) assembly.
    segment: (inputs.segment || '').trim(),
    autoApprove: parseBoolInput(inputs.autoApproveRaw),
  };

  const manifest = parseJsonInput(inputs.deployManifestRaw, 'deploy_manifest');
  if (manifest && (typeof manifest !== 'object' || Array.isArray(manifest))) {
    throw new Error('deploy_manifest must be a JSON object.');
  }

  // Warn (don't fail) when a named input overrides a deploy_manifest field — no silent ambiguity.
  if (manifest) {
    for (const [namedKey, manifestKey] of [
      ['blueprint', 'blueprint'],
      ['version', 'version'],
    ]) {
      if (named[namedKey] && manifest[manifestKey] && named[namedKey] !== manifest[manifestKey]) {
        warnings.push(`Both '${namedKey}' input and deploy_manifest.${manifestKey} set — using the named input.`);
      }
    }
    if (named.artifacts !== undefined && manifest.artifacts) {
      warnings.push("Both 'artifacts' input and deploy_manifest.artifacts set — using the named input.");
    }
  }

  const merged = mergeInputs(named, manifest);

  if (!merged.blueprint) {
    throw new Error('blueprint is required (set the `blueprint` input or deploy_manifest.blueprint).');
  }
  if (!isValidVersion(merged.version)) {
    throw new Error(`version must be valid semver (got '${merged.version}').`);
  }

  const artifacts = merged.artifacts || {};
  if (typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new Error('artifacts must be a JSON object mapping slot_key -> link.');
  }

  const baseUrl = resolveServerUrl(triggerEnvironment);
  const url = `${baseUrl}/api/external/deploy/release`;

  // Warn if the API key is about to be sent somewhere other than *.lynxtrac.com (or localhost) —
  // a typo'd/tampered full-URL trigger_environment would otherwise leak the key silently.
  try {
    const host = new URL(baseUrl).hostname;
    const trusted = host === 'lynxtrac.com' || host.endsWith('.lynxtrac.com') || host === 'localhost' || host === '127.0.0.1';
    if (!trusted) {
      warnings.push(`trigger_environment host '${host}' is not a lynxtrac.com domain — sending the API key there.`);
    }
  } catch {
    // baseUrl is always a valid URL by construction; ignore.
  }

  const body = { blueprint: merged.blueprint, version: merged.version, artifacts };
  if (merged.releaseName) {
    body.release_name = merged.releaseName;
  }
  if (merged.description) {
    body.description = merged.description;
  }
  if (commit) {
    body.commit = commit;
  }
  if (branch) {
    body.branch = normalizeRef(branch);
  }
  if (source) {
    body.source = source; // LT-9308 — CI provider (github | bitbucket), persisted for provenance.
  }
  // LT-9925 — multi-source (Blueprint Streams): the blueprint segment this trigger contributes and whether
  // to auto-approve on completion. The backend ignores both for SINGLE blueprints.
  if (merged.segment) {
    body.segment = merged.segment;
  }
  if (merged.autoApprove !== undefined) {
    body.auto_approve = Boolean(merged.autoApprove);
  }

  return {
    url,
    headers: { 'Content-Type': 'application/json', Authorization: `Api-Key ${apikey}` },
    body,
    warnings,
  };
}

/**
 * Reduce a URL to its base (scheme + host), dropping any path/query. LT-9312 — workflow output may
 * expose only the base URL, never the deploy API path. Returns the input unchanged if it can't parse.
 */
function toBaseUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Build a detailed, human-readable multi-line summary of a successful deploy (Task 7).
 * Uses the backend `report` (per-task/file breakdown + resolved/omitted/extra) when present,
 * and degrades gracefully to a concise summary when it is not (e.g. idempotent re-runs).
 *
 * @param {object} data  Parsed backend response body.
 * @param {{ url?: string, environment?: string }} ctx
 * @returns {string}
 */
function formatDeploySummary(data = {}, ctx = {}) {
  const { url = '', environment = '' } = ctx;
  const report = data.report || null;
  const lines = [];

  // LT-9312 — display only the base URL (scheme+host), never the deploy API path.
  const displayUrl = toBaseUrl(url);
  // LT-9310/9312 — identify the release by code + name, never the internal DB id.
  const releaseLabel =
    [data.release_code, data.release_name ? `"${data.release_name}"` : ''].filter(Boolean).join(' ') || '-';

  lines.push(`LynxTrac Deploy — ${environment || 'production'}${displayUrl ? `  (${displayUrl})` : ''}`);

  if (report && report.blueprint) {
    const bp = report.blueprint;
    lines.push(
      `Blueprint : ${bp.name || '-'} (${bp.code || '-'})` + (bp.product ? `     Product: ${bp.product}` : ''),
    );
  }

  const version = (report && report.version) || data.version || '-';
  const prov = [];
  if (report && report.commit) prov.push(`Commit: ${report.commit}`);
  if (report && report.branch) prov.push(`Branch: ${report.branch}`);
  lines.push(`Version   : ${version}${prov.length ? `   ${prov.join('   ')}` : ''}`);

  const idem = data.status === 'ALREADY_EXISTS' ? 'idempotent — no change' : data.healed ? 'healed' : 'new';
  lines.push('');
  lines.push(
    `> Release ${releaseLabel}   ` + `status=${data.release_status || '-'}   source=CI_PIPELINE   (${idem})`,
  );

  // LT-9925 — multi-source (Blueprint Streams) assembly progress (present only for MULTI_SOURCE blueprints).
  if (data.assembly) {
    const a = data.assembly;
    const present = (a.present || []).length;
    const expected = (a.expected || []).length;
    lines.push('');
    lines.push(
      `Assembly  : ${a.state || '-'}   (${present}/${expected} segments)` +
        (a.missing && a.missing.length ? `   Awaiting: ${a.missing.join(', ')}` : ''),
    );
    if (data.message) {
      lines.push(`  ${data.message}`);
    }
  }

  if (report && Array.isArray(report.tasks) && report.tasks.length) {
    const counts = report.counts || data.created || {};
    lines.push('');
    lines.push(`Tasks (${counts.tasks != null ? counts.tasks : report.tasks.length}) · Files (${counts.files != null ? counts.files : '?'})`);
    report.tasks.forEach((task) => {
      lines.push(`  ${task.order}. ${task.code || task.name || '-'}   ${task.type || ''}`.replace(/\s+$/, ''));
      (task.files || []).forEach((f) => {
        const meta = [];
        if (f.checksum_algorithm) meta.push(f.checksum_algorithm);
        if (f.expiry_hours) meta.push(`${f.expiry_hours}h`);
        const metaStr = meta.length ? `   (${meta.join(', ')})` : '';
        const dest = f.link ? ` -> ${f.link}` : '';
        const tag = f.extra ? ' [extra]' : '';
        lines.push(`       - ${f.name}${tag}   ${f.action || ''} ${f.origin || ''}${dest}${metaStr}`.replace(/\s+$/, ''));
      });
    });

    const resolved = Object.keys(report.resolved || {});
    lines.push('');
    lines.push(`Slots resolved: ${resolved.length ? resolved.join(', ') : 'none'}`);
    lines.push(
      `Omitted: ${report.omitted && report.omitted.length ? report.omitted.join(', ') : 'none'}` +
        `    Extra: ${report.extra && report.extra.length ? report.extra.join(', ') : 'none'}`,
    );
  }

  if (data.rollout) {
    lines.push(
      `Rollout: ${data.rollout.triggered ? 'triggered (on-demand)' : `not triggered (${data.rollout.error || 'n/a'})`}`,
    );
  }

  const counts = data.created || (report && report.counts) || {};
  lines.push('');
  lines.push(
    `${data.status || 'OK'}: ${releaseLabel} ` +
      `(${data.release_status || '-'}) — ${counts.tasks != null ? counts.tasks : '?'} tasks, ` +
      `${counts.files != null ? counts.files : '?'} files.`,
  );

  return lines.join('\n');
}

module.exports = {
  SERVER_ALIASES,
  resolveServerUrl,
  toBaseUrl,
  isValidApiKey,
  isValidVersion,
  parseJsonInput,
  parseBoolInput,
  normalizeRef,
  mergeInputs,
  buildRequest,
  formatDeploySummary,
};
