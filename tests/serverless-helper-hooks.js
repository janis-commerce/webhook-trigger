/* eslint-disable no-template-curly-in-string */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const sinon = require('sinon');

const { invokePermissions } = require('@janiscommerce/lambda');

const serverlessHelperHooks = require('../lib/serverless-helper-hooks');

describe('serverless-helper-hooks', () => {

	const buildSQSHelper = () => ({
		sqsPermissions: 'SQS_PERMISSIONS',
		buildHooks: sinon.stub().returns(['MAIN_CONSUMER', 'MAIN_QUEUE'])
	});

	const consumerHooks = ['SQS_PERMISSIONS', 'MAIN_CONSUMER', 'MAIN_QUEUE', ...invokePermissions];

	const emitterHooks = [
		['envVars', {
			JANIS_WEBHOOKS_QUEUE_URL: '${env:JANIS_WEBHOOKS_QUEUE_URL}'
		}],
		['iamStatement', {
			action: 'sqs:SendMessage',
			resource: 'arn:aws:sqs:us-east-1:123456789012:janis-webhooks-queue'
		}]
	];

	const defaultHandlerPath = path.join(process.cwd(), 'src', 'sqs-consumer', 'webhook', 'sync-webhook-subscriptions-consumer.js');

	afterEach(() => {
		sinon.restore();
		delete process.env.JANIS_WEBHOOKS_QUEUE_URL;
	});

	it('Should throw when the SQSHelper is not injected', () => {
		assert.throws(() => serverlessHelperHooks(), /SQSHelper/);
	});

	it('Should throw when the consumer handler file does not exist in the host service', () => {

		sinon.stub(fs, 'existsSync').returns(false);

		assert.throws(() => serverlessHelperHooks(buildSQSHelper()), error => {
			assert.match(error.message, /consumer handler file/);
			assert.ok(error.message.includes(defaultHandlerPath));
			return true;
		});

		sinon.assert.calledOnceWithExactly(fs.existsSync, defaultHandlerPath);
	});

	it('Should return the emitter hooks plus the consumer hooks when JANIS_WEBHOOKS_QUEUE_URL is set', () => {

		sinon.stub(fs, 'existsSync').returns(true);

		process.env.JANIS_WEBHOOKS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/janis-webhooks-queue';

		const SQSHelper = buildSQSHelper();

		assert.deepStrictEqual(serverlessHelperHooks(SQSHelper), [
			...emitterHooks,
			...consumerHooks
		]);
	});

	it('Should return only the consumer hooks when JANIS_WEBHOOKS_QUEUE_URL is not set', () => {

		sinon.stub(fs, 'existsSync').returns(true);

		const SQSHelper = buildSQSHelper();

		assert.deepStrictEqual(serverlessHelperHooks(SQSHelper), consumerHooks);
	});

	it('Should resolve the handler path with a custom prefixPath and forward the options to the consumer hooks', () => {

		sinon.stub(fs, 'existsSync').returns(true);

		const SQSHelper = buildSQSHelper();

		const options = {
			consumerProperties: { prefixPath: 'custom-path', batchSize: 5 }
		};

		serverlessHelperHooks(SQSHelper, options);

		const customHandlerPath = path.join(process.cwd(), 'src', 'sqs-consumer', 'custom-path', 'sync-webhook-subscriptions-consumer.js');

		sinon.assert.calledOnceWithExactly(fs.existsSync, customHandlerPath);
		sinon.assert.calledOnceWithExactly(SQSHelper.buildHooks, sinon.match({
			consumerProperties: sinon.match({ prefixPath: 'custom-path', batchSize: 5 })
		}));
	});
});
