// Internal manual runner for the GitHub Actions entry point.
// Sets the INPUT_* env vars exactly as GitHub Actions would, then invokes the action directly.
// Point INPUT_TRIGGER_ENVIRONMENT at a reachable backend (e.g. `local`) before running.

process.env.INPUT_APIKEY = '1q2w3e4r5t'; // Valid API key
process.env.INPUT_BLUEPRINT = 'Bp2'; // Blueprint code from lynxtrac
process.env.INPUT_VERSION = '1.0.0'; // Version of the release
process.env.INPUT_TRIGGER_ENVIRONMENT = 'local'; // LynxTrac target environment
process.env.INPUT_ARTIFACTS = JSON.stringify({
  lh109_f1: `A valid link to a file`,
}); // Artifacts to be deployed, in JSON format

const action = require('../../src/github');

action.run();
