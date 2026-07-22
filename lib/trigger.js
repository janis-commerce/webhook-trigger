'use strict';

const { inspect } = require('node:util');

const logger = require('lllog')();

const Validator = require('./validator');
const SQS = require('./helpers/sqs');
const hasSubscription = require('./helpers/has-subscription');

/**
 * @typedef {object} WebhookEvent An event to be triggered
 * @property {string} clientCode The Janis Client code
 * @property {string} entity The name of the entity associated to this trigger
 * @property {string} eventName The name of the event associated to this trigger
 * @property {string|Object<string,any>} content The content of the trigger. If it's not a string it will be JSON encoded
 * @property {string} [targetUserId] Optional. If provided, only webhook subscriptions created by this user will be triggered
 * @property {string} [correlationId] Optional. Only used by `sendBatch`. Echoed back in the corresponding `output` to let the
 * caller correlate each result with its originating event. It's metadata only: it's never sent to the webhook subscriber
 */

/**
 * @typedef {object} SendOptions
 * @property {string} [targetUserId] If provided, only webhook subscriptions created by this user will be triggered
 */

module.exports = class WebhookTrigger {

	/**
	 * Send a webhook event
	 *
	 * @param {string} clientCode The Janis Client code
	 * @param {string} entity The name of the entity associated to this trigger
	 * @param {string} eventName The name of the event associated to this trigger
	 * @param {string|object} content The content of the trigger. If it's not a string it will be JSON encoded
	 * @param {SendOptions} [options] Optional send options
	 * @returns {Promise<import('./helpers/sqs').SendMessageSuccess|import('./helpers/sqs').SendMessageError|import('./helpers/sqs').SendMessageSkipped>}
	 * @throws If call to the webhook service fails
	 */
	static async send(clientCode, entity, eventName, content, { targetUserId } = {}) {

		if(!process.env.JANIS_WEBHOOKS_QUEUE_URL)
			throw new Error('Missing env var JANIS_WEBHOOKS_QUEUE_URL');

		if(!process.env.JANIS_SERVICE_NAME)
			throw new Error('Missing env var JANIS_SERVICE_NAME');

		Validator.validateEvent(clientCode, entity, eventName, content);

		if(!await hasSubscription(clientCode, entity, eventName)) {
			logger.info('Skipping webhook event, client has no active subscription', {
				clientCode, service: process.env.JANIS_SERVICE_NAME, entity, eventName
			});
			return { success: true, skipped: true };
		}

		const event = {
			service: process.env.JANIS_SERVICE_NAME,
			entity,
			eventName,
			content: typeof content === 'string' ? content : JSON.stringify(content),
			...(targetUserId && { targetUserId })
		};

		return SQS.sendMessage(clientCode, event);
	}

	/**
	 * Send multiple webhook events
	 *
	 * @param {WebhookEvent[]} events
	 * @returns {Promise<import('./helpers/sqs').SendMessageBatchResult>}
	 * @throws If the JANIS_WEBHOOKS_QUEUE_URL env var is not set
	 */
	static async sendBatch(events) {

		if(!process.env.JANIS_WEBHOOKS_QUEUE_URL)
			throw new Error('Missing env var JANIS_WEBHOOKS_QUEUE_URL');

		if(!process.env.JANIS_SERVICE_NAME)
			throw new Error('Missing env var JANIS_SERVICE_NAME');

		if(!Array.isArray(events))
			throw new Error(`Expected an array of events received ${inspect(events)}`);

		/** @type {import('./helpers/sqs').SendMessageBatchResult} */
		const result = {
			successCount: 0,
			failedCount: 0,
			skippedCount: 0,
			outputs: []
		};

		const chunks = [];
		let batch = [];

		/**
		 * The `correlationId` of each event that reached the batch, keyed by its SQS batch entry `Id` (the `eventIndex`).
		 * The SQS entry `Id` itself is never the `correlationId`: it could contain invalid characters or be repeated.
		 * @type {Record<string, string>}
		 */
		const correlationIdByIndex = {};

		// Helper function to avoid duplicate code.
		// It flushes the current batch to the chunks array if it's not empty
		const flushBatch = () => {

			if(!batch.length)
				return;

			chunks.push(batch);
			batch = [];
		};

		for(let eventIndex = 0; eventIndex < events.length; eventIndex++) {

			const {
				clientCode, entity, eventName, content, targetUserId, correlationId
			} = events[eventIndex];

			try {
				Validator.validateEvent(clientCode, entity, eventName, content);
			} catch(error) {
				result.failedCount++;
				result.outputs.push({
					success: false,
					message: events[eventIndex],
					errorMessage: error.message,
					...(correlationId !== undefined && { correlationId })
				});
				continue;
			}

			if(!await hasSubscription(clientCode, entity, eventName)) {
				logger.info('Skipping webhook event, client has no active subscription', {
					clientCode, service: process.env.JANIS_SERVICE_NAME, entity, eventName
				});
				result.skippedCount++;
				result.outputs.push({
					success: true,
					skipped: true,
					message: events[eventIndex],
					...(correlationId !== undefined && { correlationId })
				});
				continue;
			}

			correlationIdByIndex[eventIndex] = correlationId;

			batch.push({
				Id: eventIndex.toString(),
				MessageBody: JSON.stringify({
					service: process.env.JANIS_SERVICE_NAME,
					entity,
					eventName,
					content: typeof content === 'string' ? content : JSON.stringify(content),
					...(targetUserId && { targetUserId })
				}),
				MessageAttributes: {
					'janis-client': {
						DataType: 'String',
						StringValue: clientCode
					}
				}
			});

			// Flush full batch
			if(batch.length === SQS.maxBatchSize)
				flushBatch();

		}

		// Flush potential partially filled batch
		flushBatch();

		if(!chunks.length)
			return result;

		return SQS.sendMessagesBatch(chunks, result, correlationIdByIndex);
	}

	/**
	 * Checks whether an event should be sent, based on the client's locally synced webhook subscriptions
	 * (see `Subscription pre-filtering` in the README). Useful to short-circuit expensive processing
	 * (eg. building the webhook content) before even attempting to send.
	 *
	 * Fail-open: resolves `true` when the client has no synced subscriptions or the read fails.
	 *
	 * @param {string} clientCode The Janis Client code
	 * @param {string} entity The name of the entity associated to this trigger
	 * @param {string} eventName The name of the event associated to this trigger
	 * @returns {Promise<boolean>} Whether the event should be sent
	 * @throws If the JANIS_SERVICE_NAME env var is not set
	 */
	static async shouldSend(clientCode, entity, eventName) {

		if(!process.env.JANIS_SERVICE_NAME)
			throw new Error('Missing env var JANIS_SERVICE_NAME');

		return hasSubscription(clientCode, entity, eventName);
	}

};
