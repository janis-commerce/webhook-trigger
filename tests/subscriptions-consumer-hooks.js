/* eslint-disable no-template-curly-in-string */

'use strict';

const assert = require('assert');
const sinon = require('sinon');

const { invokePermissions } = require('@janiscommerce/lambda');

const subscriptionsConsumerHooks = require('../lib/subscriptions-consumer-hooks');

describe('subscriptions-consumer-hooks', () => {

	const buildSQSHelper = buildHooksResult => ({
		sqsPermissions: 'SQS_PERMISSIONS',
		buildHooks: sinon.stub().returns(buildHooksResult)
	});

	afterEach(() => {
		sinon.restore();
	});

	it('Should return the sqsPermissions, the buildHooks output and the lambda invoke permissions', () => {

		const SQSHelper = buildSQSHelper(['MAIN_CONSUMER', 'MAIN_QUEUE']);

		const hooks = subscriptionsConsumerHooks(SQSHelper);

		assert.deepStrictEqual(hooks, [
			'SQS_PERMISSIONS',
			'MAIN_CONSUMER',
			'MAIN_QUEUE',
			...invokePermissions
		]);
	});

	it('Should build the hooks subscribing the queue to the remote topic (plain fanout) with the resilience chain', () => {

		const SQSHelper = buildSQSHelper([]);

		subscriptionsConsumerHooks(SQSHelper);

		sinon.assert.calledOnceWithExactly(SQSHelper.buildHooks, {
			name: 'syncWebhookSubscriptions',
			sourceSnsTopic: {
				scope: 'remote',
				serviceCode: 'webhooks',
				name: 'clientSubscriptionsUpdated'
			},
			consumerProperties: {
				prefixPath: 'webhook',
				batchSize: 1,
				maximumBatchingWindow: 20
			},
			mainQueueProperties: { maxReceiveCount: 3, generateEnvVars: false },
			delayQueueProperties: { delaySeconds: 300 },
			delayConsumerProperties: { useMainHandler: true }
		});
	});

	it('Should let the host service override the consumer, main queue and delay queue properties', () => {

		const SQSHelper = buildSQSHelper([]);

		subscriptionsConsumerHooks(SQSHelper, {
			consumerProperties: { prefixPath: 'custom-path', batchSize: 5 },
			mainQueueProperties: { maxReceiveCount: 2 },
			delayQueueProperties: { delaySeconds: 60 }
		});

		sinon.assert.calledOnceWithExactly(SQSHelper.buildHooks, {
			name: 'syncWebhookSubscriptions',
			sourceSnsTopic: {
				scope: 'remote',
				serviceCode: 'webhooks',
				name: 'clientSubscriptionsUpdated'
			},
			consumerProperties: {
				prefixPath: 'custom-path',
				batchSize: 5,
				maximumBatchingWindow: 20
			},
			mainQueueProperties: { maxReceiveCount: 2, generateEnvVars: false },
			delayQueueProperties: { delaySeconds: 60 },
			delayConsumerProperties: { useMainHandler: true }
		});
	});

	it('Should let the host service re-enable the queue URL env var by overriding generateEnvVars', () => {

		const SQSHelper = buildSQSHelper([]);

		subscriptionsConsumerHooks(SQSHelper, {
			mainQueueProperties: { generateEnvVars: true }
		});

		sinon.assert.calledOnceWithExactly(SQSHelper.buildHooks, {
			name: 'syncWebhookSubscriptions',
			sourceSnsTopic: {
				scope: 'remote',
				serviceCode: 'webhooks',
				name: 'clientSubscriptionsUpdated'
			},
			consumerProperties: {
				prefixPath: 'webhook',
				batchSize: 1,
				maximumBatchingWindow: 20
			},
			mainQueueProperties: { maxReceiveCount: 3, generateEnvVars: true },
			delayQueueProperties: { delaySeconds: 300 },
			delayConsumerProperties: { useMainHandler: true }
		});
	});

	it('Should expose the default prefix path used to mount the consumer', () => {
		assert.strictEqual(subscriptionsConsumerHooks.DEFAULT_PREFIX_PATH, 'webhook');
	});

	it('Should expose the consumer handler filename derived from the queue name', () => {
		assert.strictEqual(subscriptionsConsumerHooks.CONSUMER_HANDLER_FILE, 'sync-webhook-subscriptions-consumer.js');
	});
});
