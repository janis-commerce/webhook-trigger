/* eslint-disable no-template-curly-in-string */

'use strict';

const { invokePermissions } = require('@janiscommerce/lambda');

/**
 * Default folder (under `src/sqs-consumer/`) where the host service mounts the consumer handler.
 * Combined with the queue name it yields the handler path `src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.handler`.
 */
const DEFAULT_PREFIX_PATH = 'webhook';

/**
 * Name of the subscriptions consumer queue. SQSHelper derives the queue logical IDs and the handler
 * filename from it, so it's the single source both the queue and the handler-path guard live off.
 */
const CONSUMER_NAME = 'syncWebhookSubscriptions';

/**
 * Handler filename SQSHelper expects under `src/sqs-consumer/<prefixPath>/`, derived from CONSUMER_NAME
 * with the same kebab-case rule SQSHelper uses, so it stays in sync if the queue name ever changes.
 */
const CONSUMER_HANDLER_FILE = `${CONSUMER_NAME.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}-consumer.js`;

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
		name: CONSUMER_NAME,
		sourceSnsTopic: {
			scope: 'remote',
			serviceCode: 'webhooks',
			name: 'clientSubscriptionsUpdated'
		},
		consumerProperties: {
			prefixPath: DEFAULT_PREFIX_PATH,
			batchSize: 1,
			maximumBatchingWindow: 20,
			...consumerProperties
		},
		mainQueueProperties: {
			maxReceiveCount: 3,
			// The queue is fed by the SNS topic and only read by the consumer via its event source,
			// so no producer needs the queue URL. Skipping the env var keeps the host service's lambdas
			// away from the 4KB environment variables limit.
			generateEnvVars: false,
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

// Exposed so the combined `serverlessHelperHooks` resolves the consumer handler path from the same
// source used here to mount the consumer (folder + filename), keeping a single source of truth.
module.exports.DEFAULT_PREFIX_PATH = DEFAULT_PREFIX_PATH;
module.exports.CONSUMER_HANDLER_FILE = CONSUMER_HANDLER_FILE;
