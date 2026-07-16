/* eslint-disable no-template-curly-in-string */

'use strict';

const { invokePermissions } = require('@janiscommerce/lambda');

/**
 * Default folder (under `src/sqs-consumer/`) where the host service mounts the consumer handler.
 * Combined with the queue name it yields the handler path `src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.handler`.
 */
const DEFAULT_PREFIX_PATH = 'webhook';

/**
 * @typedef {object} SubscriptionsConsumerHooksOptions
 * @property {object} [consumerProperties] Overrides for the main consumer properties (prefixPath, batchSize, etc.)
 * @property {object} [mainQueueProperties] Overrides for the main queue properties
 * @property {object} [delayQueueProperties] Overrides for the delay queue properties
 */

/**
 * Builds the serverless hooks the host service needs to mount the webhook subscriptions consumer.
 *
 * Subscribes the queue to the remote `webhooks/clientSubscriptionsUpdated` topic filtered by this
 * service, sets up the MainQueue -> DelayQueue -> DLQ resilience chain and adds the IAM permissions
 * required to invoke the `ClientTriggersSubscriptions` lambda.
 *
 * `SQSHelper` is injected by the host service so the package does not depend on `sls-helper-plugin-janis`.
 *
 * @param {import('sls-helper-plugin-janis').SQSHelper} SQSHelper The SQSHelper from the host service
 * @param {SubscriptionsConsumerHooksOptions} [options]
 * @returns {Array} The serverless hooks array
 */
module.exports = (SQSHelper, { consumerProperties = {}, mainQueueProperties = {}, delayQueueProperties = {} } = {}) => [

	SQSHelper.sqsPermissions,

	...SQSHelper.buildHooks({
		name: 'syncWebhookSubscriptions',
		sourceSnsTopic: {
			scope: 'remote',
			serviceCode: 'webhooks',
			name: 'clientSubscriptionsUpdated',
			filterPolicy: { services: ['${self:custom.serviceCode}'] }
		},
		consumerProperties: {
			prefixPath: DEFAULT_PREFIX_PATH,
			batchSize: 1,
			maximumBatchingWindow: 20,
			...consumerProperties
		},
		mainQueueProperties: {
			maxReceiveCount: 3,
			...mainQueueProperties
		},
		delayQueueProperties: {
			delaySeconds: 300,
			...delayQueueProperties
		},
		delayConsumerProperties: { useMainHandler: true }
	}),

	...invokePermissions
];
