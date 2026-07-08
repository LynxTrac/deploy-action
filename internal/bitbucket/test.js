// Internal manual runner for the Bitbucket Pipelines entry point.
// Sets the env vars exactly as a Bitbucket pipeline (Repository variables + inline) would, then
// invokes the entry directly. Point TRIGGER_ENVIRONMENT at a reachable backend (e.g. `local`).

process.env.APIKEY = '1q2w3e4r5t'; // Valid API key
process.env.BLUEPRINT = 'Bp2'; // Blueprint code from lynxtrac
process.env.VERSION = '1.0.0'; // Version of the release
process.env.TRIGGER_ENVIRONMENT = 'local'; // LynxTrac target environment
process.env.ARTIFACTS = JSON.stringify({
  lh109_f1: `A valid link to a file`,
}); // Artifacts to be deployed, in JSON format

const action = require('../../src/bitbucket');

action.run();
