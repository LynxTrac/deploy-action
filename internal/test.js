process.env.INPUT_APIKEY = '1q2w3e4r5t';
process.env.INPUT_BLUEPRINT = 'test-blueprint';
process.env.INPUT_VERSION = '1.2.3';
process.env.INPUT_DEPLOYMENT_REQUEST = JSON.stringify({
  deploymentModel: 'LRT12'
});

require('../dist/index');
