/* eslint-disable no-template-curly-in-string */

'use strict';

const assert = require('assert');
const sinon = require('sinon');

const { invokePermissions } = require('@janiscommerce/lambda');

const { subscriptionsConsumerServerlessHelperHooks } = require('../lib');

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

		const hooks = subscriptionsConsumerServerlessHelperHooks(SQSHelper);

		assert.deepStrictEqual(hooks, [
			'SQS_PERMISSIONS',
			'MAIN_CONSUMER',
			'MAIN_QUEUE',
			...invokePermissions
		]);
	});

	it('Should build the hooks subscribing the queue to the remote topic filtered by service with the resilience chain', () => {

		const SQSHelper = buildSQSHelper([]);

		subscriptionsConsumerServerlessHelperHooks(SQSHelper);

		sinon.assert.calledOnceWithExactly(SQSHelper.buildHooks, {
			name: 'syncWebhookSubscriptions',
			sourceSnsTopic: {
				scope: 'remote',
				serviceCode: 'webhooks',
				name: 'clientSubscriptionsUpdated',
				filterPolicy: { services: ['${self:custom.serviceCode}'] }
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

		subscriptionsConsumerServerlessHelperHooks(SQSHelper, {
			consumerProperties: { prefixPath: 'custom-path', batchSize: 5 },
			mainQueueProperties: { maxReceiveCount: 2 },
			delayQueueProperties: { delaySeconds: 60 }
		});

		sinon.assert.calledOnceWithExactly(SQSHelper.buildHooks, {
			name: 'syncWebhookSubscriptions',
			sourceSnsTopic: {
				scope: 'remote',
				serviceCode: 'webhooks',
				name: 'clientSubscriptionsUpdated',
				filterPolicy: { services: ['${self:custom.serviceCode}'] }
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

		subscriptionsConsumerServerlessHelperHooks(SQSHelper, {
			mainQueueProperties: { generateEnvVars: true }
		});

		sinon.assert.calledOnceWithExactly(SQSHelper.buildHooks, {
			name: 'syncWebhookSubscriptions',
			sourceSnsTopic: {
				scope: 'remote',
				serviceCode: 'webhooks',
				name: 'clientSubscriptionsUpdated',
				filterPolicy: { services: ['${self:custom.serviceCode}'] }
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
});
