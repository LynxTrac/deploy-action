'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  resolveServerUrl,
  isValidApiKey,
  isValidVersion,
  parseJsonInput,
  normalizeRef,
  mergeInputs,
  buildRequest,
} = require('../src/lib');

test('resolveServerUrl: empty -> production', () => {
  assert.strictEqual(resolveServerUrl(''), 'https://app.lynxtrac.com');
  assert.strictEqual(resolveServerUrl(undefined), 'https://app.lynxtrac.com');
});

test('resolveServerUrl: known aliases', () => {
  assert.strictEqual(resolveServerUrl('beta'), 'https://beta.lynxtrac.com');
  assert.strictEqual(resolveServerUrl('QA'), 'https://qa.lynxtrac.com');
  assert.strictEqual(resolveServerUrl('app'), 'https://app.lynxtrac.com');
});

test('resolveServerUrl: full URL escape hatch (trailing slash trimmed)', () => {
  assert.strictEqual(resolveServerUrl('https://localhost:3000/'), 'https://localhost:3000');
  assert.strictEqual(resolveServerUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
});

test('resolveServerUrl: unknown alias is rejected (allowlist)', () => {
  assert.throws(() => resolveServerUrl('staging-typo'), /Invalid lynxserver/);
});

test('isValidApiKey / isValidVersion', () => {
  assert.strictEqual(isValidApiKey('abcd1234'), true);
  assert.strictEqual(isValidApiKey('short'), false);
  assert.strictEqual(isValidVersion('2.5.0'), true);
  assert.strictEqual(isValidVersion('2.5.0-rc.1'), true);
  assert.strictEqual(isValidVersion('latest'), false);
});

test('parseJsonInput: empty -> undefined, bad -> throws', () => {
  assert.strictEqual(parseJsonInput('', 'x'), undefined);
  assert.deepStrictEqual(parseJsonInput('{"a":1}', 'x'), { a: 1 });
  assert.throws(() => parseJsonInput('{bad', 'artifacts'), /artifacts is not valid JSON/);
});

test('normalizeRef strips refs/heads|tags', () => {
  assert.strictEqual(normalizeRef('refs/heads/main'), 'main');
  assert.strictEqual(normalizeRef('refs/tags/v1.2.3'), 'v1.2.3');
  assert.strictEqual(normalizeRef('develop'), 'develop');
});

test('mergeInputs: named wins, modal fills gaps', () => {
  const merged = mergeInputs(
    { blueprint: 'web-prod', version: '', artifacts: undefined, releaseName: '', description: '' },
    { blueprint: 'ignored', version: '2.5.0', artifacts: { a: 'x' }, release: { name: 'Rel', description: 'd' } },
  );
  assert.strictEqual(merged.blueprint, 'web-prod'); // named wins
  assert.strictEqual(merged.version, '2.5.0'); // modal fills
  assert.deepStrictEqual(merged.artifacts, { a: 'x' });
  assert.strictEqual(merged.releaseName, 'Rel');
});

test('buildRequest: valid named inputs', () => {
  const { url, headers, body } = buildRequest({
    apikey: 'apikey-123',
    lynxserver: 'beta',
    blueprint: 'web-prod',
    version: '2.5.0',
    artifactsRaw: '{"app-bundle":"https://ci/app.zip"}',
    releaseName: 'Web 2.5.0',
    commit: 'abc123',
    branch: 'refs/heads/main',
  });
  assert.strictEqual(url, 'https://beta.lynxtrac.com/api/external/deploy/release');
  assert.strictEqual(headers.Authorization, 'Api-Key apikey-123');
  assert.strictEqual(body.blueprint, 'web-prod');
  assert.deepStrictEqual(body.artifacts, { 'app-bundle': 'https://ci/app.zip' });
  assert.strictEqual(body['release-name'], 'Web 2.5.0');
  assert.strictEqual(body.branch, 'main');
  assert.strictEqual(body.commit, 'abc123');
});

test('buildRequest: deploy-modal alias', () => {
  const { url, body } = buildRequest({
    apikey: 'apikey-123',
    lynxserver: '',
    deployModalRaw: JSON.stringify({
      blueprint: 'web-prod',
      version: '3.0.0',
      artifacts: { 'app-bundle': 'https://ci/app.zip' },
      release: { name: 'R3', description: 'desc' },
    }),
  });
  assert.strictEqual(url, 'https://app.lynxtrac.com/api/external/deploy/release');
  assert.strictEqual(body.blueprint, 'web-prod');
  assert.strictEqual(body.version, '3.0.0');
  assert.strictEqual(body['release-name'], 'R3');
  assert.strictEqual(body.description, 'desc');
});

test('buildRequest: artifact value may be an object (checksum) and is passed through', () => {
  const { body } = buildRequest({
    apikey: 'apikey-123',
    blueprint: 'web-prod',
    version: '2.5.0',
    artifactsRaw: JSON.stringify({
      app: { link: 'https://ci/app.zip', checksum: 'abc123', checksumType: 'sha256' },
      cfg: 'https://ci/cfg.json',
    }),
  });
  assert.deepStrictEqual(body.artifacts.app, { link: 'https://ci/app.zip', checksum: 'abc123', checksumType: 'sha256' });
  assert.strictEqual(body.artifacts.cfg, 'https://ci/cfg.json');
});

test('buildRequest: named input overrides deploy-modal and warns', () => {
  const { body, warnings } = buildRequest({
    apikey: 'apikey-123',
    blueprint: 'named-bp',
    version: '1.0.0',
    deployModalRaw: JSON.stringify({ blueprint: 'modal-bp', version: '2.0.0', artifacts: {} }),
  });
  assert.strictEqual(body.blueprint, 'named-bp');
  assert.strictEqual(body.version, '1.0.0');
  assert.ok(warnings.length >= 1);
});

test('buildRequest: rejects bad apikey / version / missing blueprint', () => {
  assert.throws(() => buildRequest({ apikey: 'short' }), /apikey is required/);
  assert.throws(
    () => buildRequest({ apikey: 'apikey-123', blueprint: 'bp', version: 'nope' }),
    /valid semver/,
  );
  assert.throws(() => buildRequest({ apikey: 'apikey-123', version: '1.0.0' }), /blueprint is required/);
});

test('resolveServerUrl: local/dev aliases point at localhost', () => {
  assert.strictEqual(resolveServerUrl('local'), 'http://localhost:5566');
  assert.strictEqual(resolveServerUrl('dev'), 'http://localhost:5566');
});

test('resolveServerUrl: rejects a non-http(s) URL / unknown alias', () => {
  assert.throws(() => resolveServerUrl('ftp://files.example.com'), /Invalid lynxserver/);
  assert.throws(() => resolveServerUrl('staging-typo'), /Invalid lynxserver/);
});

test('buildRequest: rejects array artifacts (top-level must be an object map)', () => {
  assert.throws(
    () => buildRequest({ apikey: 'apikey-123', blueprint: 'bp', version: '1.0.0', artifactsRaw: '[]' }),
    /artifacts must be a JSON object/,
  );
});

test('buildRequest: warns when sending the key off the lynxtrac.com domain', () => {
  const { warnings } = buildRequest({
    apikey: 'apikey-123',
    lynxserver: 'https://evil.example.com',
    blueprint: 'bp',
    version: '1.0.0',
    artifactsRaw: '{}',
  });
  assert.ok(warnings.some((w) => /not a lynxtrac\.com domain/.test(w)));
});

test('buildRequest: no off-domain warning for localhost (dev)', () => {
  const { warnings } = buildRequest({
    apikey: 'apikey-123',
    lynxserver: 'local',
    blueprint: 'bp',
    version: '1.0.0',
    artifactsRaw: '{}',
  });
  assert.ok(!warnings.some((w) => /not a lynxtrac\.com domain/.test(w)));
});
