'use strict';

/**
 * Node.js version gate for the LynxTrac deploy action.
 *
 * The action uses the global `fetch`, which only exists on Node 18+. On older Node (e.g. a Bitbucket
 * runner defaulting to Node 14/16) the request code would otherwise crash with a cryptic
 * "ReferenceError: fetch is not defined". This gate fails fast with a clear, actionable message
 * instead. It must run BEFORE the entry's `run()` is called, because `run()`'s `fetchApi = fetch`
 * default parameter is evaluated on invocation and would throw the ReferenceError first.
 */
const MIN_NODE_MAJOR = 18;

/** True when `versionString` (e.g. "18.20.4") is a supported major version. */
function isSupportedNode(versionString = process.versions.node) {
  const major = Number(String(versionString).split('.')[0]);
  return Number.isFinite(major) && major >= MIN_NODE_MAJOR;
}

/**
 * Fail fast on an unsupported Node runtime. Returns true when the version is OK (caller proceeds);
 * otherwise prints a clear message and exits with code 1 (returning false if `exit` doesn't halt).
 * `version`, `error`, and `exit` are injectable for testing.
 */
function assertSupportedNode({
  version = process.versions.node,
  error = (message) => console.error(message),
  exit = (code) => process.exit(code),
} = {}) {
  if (isSupportedNode(version)) {
    return true;
  }
  error(
    `lynxtrac-deploy requires Node.js >= ${MIN_NODE_MAJOR}, but this runner is on Node ${version}. ` +
      `Pin a modern Node in your pipeline — e.g. "image: node:22" in bitbucket-pipelines.yml.`,
  );
  exit(1);
  return false;
}

module.exports = { MIN_NODE_MAJOR, isSupportedNode, assertSupportedNode };
