'use strict';

const { IterativeSQSConsumer } = require('@janiscommerce/sqs-consumer');
const { Invoker } = require('@janiscommerce/lambda');

const ClientModel = require('./helpers/client-model');

const WEBHOOKS_SERVICE_CODE = 'webhooks';
const CLIENT_TRIGGERS_SUBSCRIPTIONS_FUNCTION = 'ClientTriggersSubscriptions';

/**
 * SQS consumer subscribed to the webhooks-service `clientSubscriptionsUpdated` topic.
 *
 * On each notification it reconsolidates the client's subscriptions by invoking the
 * `ClientTriggersSubscriptions` lambda (session-scoped to the client, filtered by this service)
 * and overwrites the local `clients.webhookSubscriptions` copy. The topic payload is informational:
 * the consumer never applies its `triggersEvents`, it always reconsolidates and overwrites (idempotent).
 */
module.exports = class SyncWebhookSubscriptionsConsumer extends IterativeSQSConsumer {

	async processSingleRecord(record, logger) {

		const { clientCode } = record.body || {};

		if(!clientCode) {
			logger.error('Discarding webhook subscriptions record without clientCode', record.body);
			return;
		}

		try {

			const { payload } = await Invoker.serviceClientCall(
				WEBHOOKS_SERVICE_CODE,
				CLIENT_TRIGGERS_SUBSCRIPTIONS_FUNCTION,
				clientCode,
				{ serviceCode: process.env.JANIS_SERVICE_NAME }
			);

			if(!Array.isArray(payload?.triggersEvents))
				throw new Error(`Invalid ClientTriggersSubscriptions response for client '${clientCode}'`);

			await ClientModel.updateSubscriptions(clientCode, payload.triggersEvents);

		} catch(error) {
			logger.error('Failed to sync webhook subscriptions', { clientCode, errorMessage: error.message });
			this.addFailedMessage(record.messageId);
		}
	}
};
