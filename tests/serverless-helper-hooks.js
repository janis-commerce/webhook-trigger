'use strict';

const assert = require('assert');

const serverlessHelperHooks = require('../lib/serverless-helper-hooks');

describe('serverless-helper-hooks', () => {

	afterEach(() => {
		delete process.env.JANIS_WEBHOOKS_QUEUE_URL;
	});

	it('Should return an empty array when JANIS_WEBHOOKS_QUEUE_URL is not set', () => {
		assert.deepStrictEqual(serverlessHelperHooks(), []);
	});

	it('Should return envVars and iamStatement hooks when JANIS_WEBHOOKS_QUEUE_URL is set', () => {

		process.env.JANIS_WEBHOOKS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/janis-webhooks-queue';

		assert.deepStrictEqual(serverlessHelperHooks(), [
			['envVars', {
				// eslint-disable-next-line no-template-curly-in-string
				JANIS_WEBHOOKS_QUEUE_URL: '${env:JANIS_WEBHOOKS_QUEUE_URL}'
			}],
			['iamStatement', {
				action: 'sqs:SendMessage',
				resource: 'arn:aws:sqs:us-east-1:123456789012:janis-webhooks-queue'
			}]
		]);
	});
});
