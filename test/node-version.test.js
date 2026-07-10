'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MIN_NODE_MAJOR, isSupportedNode, assertSupportedNode } = require('../src/node-version');

test('MIN_NODE_MAJOR is 18', () => {
  assert.strictEqual(MIN_NODE_MAJOR, 18);
});

test('isSupportedNode: 18+ supported, older rejected', () => {
  assert.strictEqual(isSupportedNode('18.0.0'), true);
  assert.strictEqual(isSupportedNode('20.11.1'), true);
  assert.strictEqual(isSupportedNode('22.14.0'), true);
  assert.strictEqual(isSupportedNode('16.20.2'), false);
  assert.strictEqual(isSupportedNode('14.20.1'), false); // the exact version that hit the fetch bug
  assert.strictEqual(isSupportedNode('12.22.0'), false);
});

test('assertSupportedNode: passes on a supported version without exiting', () => {
  let exited = null;
  const errors = [];
  const ok = assertSupportedNode({
    version: '20.0.0',
    error: (m) => errors.push(m),
    exit: (c) => (exited = c),
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(exited, null, 'must not exit on a supported version');
  assert.strictEqual(errors.length, 0);
});

test('assertSupportedNode: on Node 14 prints a VERSION error and exits 1 (not a fetch error)', () => {
  let exited = null;
  const errors = [];
  const ok = assertSupportedNode({
    version: '14.20.1',
    error: (m) => errors.push(m),
    exit: (c) => (exited = c),
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(exited, 1);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /requires Node\.js >= 18/);
  assert.match(errors[0], /Node 14\.20\.1/);
  assert.ok(!/fetch is not defined/.test(errors[0]), 'surfaces a version error, not a fetch error');
});
