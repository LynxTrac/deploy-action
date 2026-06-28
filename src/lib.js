'use strict';

/**
 * LT-8787 — pure helpers for the LynxTrac deploy action.
 *
 * No network, no @actions/* — so this is unit-testable with `node --test` alone.
 * The action's I/O (reading inputs, the HTTP call, setting outputs) lives in index.js.
 */

// lynxserver resolution: allowlisted short aliases + a full-URL escape hatch (LT-8787 decision).
// Extend ALIASES as QA spins up named test servers under *.lynxtrac.com.
const SERVER_ALIASES = {
  '': 'https://app.lynxtrac.com', // production default when unspecified
  app: 'https://app.lynxtrac.com',
  beta: 'https://beta.lynxtrac.com',
  qa: 'https://qa.lynxtrac.com',
};

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Resolve the `lynxserver` input to a base URL. Allowlist alias OR full http(s) URL. */
function resolveServerUrl(lynxserver) {
  const value = (lynxserver || '').trim();
  if (!value) {
    return SERVER_ALIASES[''];
  }

  if (/^https?:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid lynxserver URL: ${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`lynxserver URL must use http(s): ${value}`);
    }
    return value.replace(/\/+$/, '');
  }

  const key = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SERVER_ALIASES, key)) {
    return SERVER_ALIASES[key];
  }

  const allowed = Object.keys(SERVER_ALIASES).filter(Boolean).join(', ');
  throw new Error(`Invalid lynxserver '${value}'. Use one of: ${allowed}, or a full http(s) URL.`);
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

/** Strip a refs/heads|tags/ prefix from a git ref. */
function normalizeRef(ref) {
  if (!ref) {
    return '';
  }
  return String(ref).replace(/^refs\/(?:heads|tags)\//, '');
}

/**
 * Merge named inputs with the deploy-modal alias object.
 * Named inputs win per field; deploy-modal fills any gaps.
 */
function mergeInputs(named, modal) {
  const m = modal || {};
  const mRelease = m.release || {};
  return {
    blueprint: named.blueprint || m.blueprint || '',
    version: named.version || m.version || '',
    artifacts: named.artifacts !== undefined ? named.artifacts : m.artifacts || {},
    releaseName: named.releaseName || mRelease.name || m.release_name || '',
    description: named.description || mRelease.description || m.description || '',
  };
}

/**
 * Validate inputs and assemble the backend request.
 * @returns {{ url: string, headers: object, body: object, warnings: string[] }}
 */
function buildRequest(inputs) {
  const { apikey, lynxserver, commit, branch } = inputs;
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
  };

  const modal = parseJsonInput(inputs.deployModalRaw, 'deploy-modal');
  if (modal && (typeof modal !== 'object' || Array.isArray(modal))) {
    throw new Error('deploy-modal must be a JSON object.');
  }

  // Warn (don't fail) when a named input overrides a deploy-modal field — no silent ambiguity.
  if (modal) {
    for (const [namedKey, modalKey] of [
      ['blueprint', 'blueprint'],
      ['version', 'version'],
    ]) {
      if (named[namedKey] && modal[modalKey] && named[namedKey] !== modal[modalKey]) {
        warnings.push(`Both '${namedKey}' input and deploy-modal.${modalKey} set — using the named input.`);
      }
    }
    if (named.artifacts !== undefined && modal.artifacts) {
      warnings.push("Both 'artifacts' input and deploy-modal.artifacts set — using the named input.");
    }
  }

  const merged = mergeInputs(named, modal);

  if (!merged.blueprint) {
    throw new Error('blueprint is required (set the `blueprint` input or deploy-modal.blueprint).');
  }
  if (!isValidVersion(merged.version)) {
    throw new Error(`version must be valid semver (got '${merged.version}').`);
  }

  const artifacts = merged.artifacts || {};
  if (typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new Error('artifacts must be a JSON object mapping slot_key -> link.');
  }

  const url = `${resolveServerUrl(lynxserver)}/api/external/deploy/release`;

  const body = { blueprint: merged.blueprint, version: merged.version, artifacts };
  if (merged.releaseName) {
    body['release-name'] = merged.releaseName;
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

  return {
    url,
    headers: { 'Content-Type': 'application/json', Authorization: `Api-Key ${apikey}` },
    body,
    warnings,
  };
}

module.exports = {
  SERVER_ALIASES,
  resolveServerUrl,
  isValidApiKey,
  isValidVersion,
  parseJsonInput,
  normalizeRef,
  mergeInputs,
  buildRequest,
};
