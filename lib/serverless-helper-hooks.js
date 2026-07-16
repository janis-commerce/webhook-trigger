/* eslint-disable no-template-curly-in-string */

'use strict';

const fs = require('fs');
const path = require('path');

const subscriptionsConsumerHooks = require('./subscriptions-consumer-hooks');

const { DEFAULT_PREFIX_PATH, CONSUMER_HANDLER_FILE } = subscriptionsConsumerHooks;

/**
 * Builds the emitter hooks (env var + IAM to send messages to the webhooks queue).
 *
 * Kept conditional on `JANIS_WEBHOOKS_QUEUE_URL`: when the queue URL is not resolvable there is no
 * emitter permission to grant, so it returns an empty array (preserving the v2 behaviour). The
 * consumer hooks are added by the caller regardless, since the consumer is mandatory in v3.
 *
 * @returns {Array} The emitter serverless hooks
 */
const buildEmitterHooks = () => {

	if(!process.env.JANIS_WEBHOOKS_QUEUE_URL)
		return [];

	const [, , domain, accountId, queueName] = process.env.JANIS_WEBHOOKS_QUEUE_URL.split('/');
	const [, region] = domain.split('.');
	const webhooksQueueArn = `arn:aws:sqs:${region}:${accountId}:${queueName}`;

	return [
		['envVars', {
			JANIS_WEBHOOKS_QUEUE_URL: '${env:JANIS_WEBHOOKS_QUEUE_URL}'
		}],
		['iamStatement', {
			action: 'sqs:SendMessage',
			resource: webhooksQueueArn
		}]
	];
};

/**
 * Single mount point for the host service (v3): returns the emitter hooks (env var + IAM to send
 * messages to the webhooks queue) plus the mandatory subscriptions consumer hooks.
 *
 * The subscriptions consumer is what keeps the local `webhookSubscriptions` copy synced and enables
 * the send-time pre-filter, so it can no longer be an opt-in separate mount: a service that only
 * spread the emitter hooks (v2 style) would never sync and would silently fail-open forever.
 *
 * Two fail-fast validations break `sls package`/`deploy` (and local runs) on misconfiguration:
 * - `SQSHelper` is required to build the consumer hooks.
 * - The consumer handler file must exist in the host service.
 *
 * @param {import('sls-helper-plugin-janis').SQSHelper} SQSHelper The SQSHelper from the host service
 * @param {import('./subscriptions-consumer-hooks').SubscriptionsConsumerHooksOptions} [options]
 * @returns {Array} The combined emitter + consumer serverless hooks
 */
module.exports = (SQSHelper, options = {}) => {

	// Required arg: validated first and unconditionally so a v2-style mount (no arg) fails fast at
	// package/deploy time instead of silently skipping the mandatory consumer.
	if(!SQSHelper)
		throw new Error('webhook-trigger v3 requires the SQSHelper injected: serverlessHelperHooks(SQSHelper)');

	// The consumer handler file lives in the host service; if it's missing the consumer would never
	// be wired and the pre-filter would never sync. We fail fast here instead of deploying a consumer
	// that can't be invoked. Runs regardless of JANIS_WEBHOOKS_QUEUE_URL because the consumer is
	// always mounted (the emitter early-return only skips the emitter hooks, not this guard).
	const { prefixPath = DEFAULT_PREFIX_PATH } = options.consumerProperties || {};
	const handlerPath = path.join(process.cwd(), 'src', 'sqs-consumer', prefixPath, CONSUMER_HANDLER_FILE);

	if(!fs.existsSync(handlerPath)) {
		throw new Error(`webhook-trigger v3 requires the consumer handler file at '${handlerPath}'. `
			+ 'Create it with a single line: '
			+ 'module.exports.handler = event => SQSHandler.handle(SyncWebhookSubscriptionsConsumer, event);');
	}

	return [
		...buildEmitterHooks(),
		...subscriptionsConsumerHooks(SQSHelper, options)
	];
};
