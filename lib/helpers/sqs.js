'use strict';

// eslint-disable-next-line import/no-extraneous-dependencies
const { SQSClient, SendMessageCommand, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const AsyncWithConcurrency = require('./async-with-concurrency');

/**
 * @typedef SendMessageSuccess
 * @property {true} success
 * @property {string} messageId
 * @property {string} [correlationId] The originating event's `correlationId`, echoed back. Present only in `sendBatch`
 * outputs, and only when the event provided it
 */

/**
 * @typedef SendMessageError
 * @property {false} success
 * @property {object} message
 * @property {string} errorMessage
 * @property {string} [correlationId] The originating event's `correlationId`, echoed back. Present only in `sendBatch`
 * outputs, and only when the event provided it
 */

/**
 * @typedef SendMessageSkipped
 * @property {true} success
 * @property {true} skipped The event was not queued because the client has no active subscription for it
 * @property {object} [message] The original event. Present only in `sendBatch` outputs
 * @property {string} [correlationId] The originating event's `correlationId`, echoed back. Present only in `sendBatch`
 * outputs, and only when the event provided it
 */

/**
 * @typedef SendMessageBatchResult
 * @property {number} successCount
 * @property {number} failedCount
 * @property {number} skippedCount
 * @property {(SendMessageSuccess|SendMessageError|SendMessageSkipped)[]} outputs
 */

const DEFAULT_MAX_CONCURRENCY = 25;

module.exports = class SQS {

	/**
	 * @type {SQSClient}
	 * @private
	 */
	static get sqsClient() {
		/** @private */
		this._sqsClient ??= new SQSClient();
		return this._sqsClient;
	}

	static get maxBatchSize() {
		return 10;
	}

	/**
	 * @param {string} clientCode
	 * @param {object} message
	 * @returns {Promise<SendMessageSuccess|SendMessageError>}
	 */
	static async sendMessage(clientCode, message) {

		try {

			const result = await this.sqsClient.send(new SendMessageCommand({
				QueueUrl: process.env.JANIS_WEBHOOKS_QUEUE_URL,
				MessageBody: JSON.stringify(message),
				MessageAttributes: {
					'janis-client': {
						DataType: 'String',
						StringValue: clientCode
					}
				}
			}));

			return {
				success: true,
				messageId: result.MessageId
			};

		} catch(error) {

			return {
				success: false,
				message: {
					clientCode,
					...message
				},
				errorMessage: error.message
			};

		}
	}

	/**
	 * @param {import('@aws-sdk/client-sqs').SendMessageBatchRequestEntry[][]} chunks
	 * @param {SendMessageBatchResult} [baseResults]
	 * @param {Record<string, string>} [correlationIdByIndex] Each event's `correlationId`, keyed by its SQS batch entry `Id`.
	 * It's metadata only: it's never included in the `MessageBody` sent to the queue
	 * @param {number} [maxConcurrency]
	 * @returns {Promise<SendMessageBatchResult>}
	 */
	static async sendMessagesBatch(chunks, baseResults, correlationIdByIndex = {}, maxConcurrency = DEFAULT_MAX_CONCURRENCY) {

		const asyncWithConcurrency = new AsyncWithConcurrency(chunk => {

			return this.sqsClient.send(new SendMessageBatchCommand({
				QueueUrl: process.env.JANIS_WEBHOOKS_QUEUE_URL,
				Entries: chunk
			}));

		}, maxConcurrency);

		/** @type {import('@aws-sdk/client-sqs').SendMessageBatchCommandOutput[]} */
		const results = await asyncWithConcurrency.run(chunks);

		return results.reduce((accum, result, resultIndex) => {

			if(result?.Successful?.length) {
				result.Successful.forEach(successfulResult => {

					const correlationId = correlationIdByIndex[successfulResult.Id];

					accum.successCount++;
					accum.outputs.push({
						success: true,
						messageId: successfulResult.MessageId,
						...(correlationId !== undefined && { correlationId })
					});
				});
			}

			if(result?.Failed?.length) {

				/** @type {import('@aws-sdk/client-sqs').SendMessageBatchRequestEntry[]} */
				const resultChunk = chunks[resultIndex];

				/** @type {Record<string, import('@aws-sdk/client-sqs').SendMessageBatchRequestEntry>} */
				const resultChunkById = resultChunk.reduce((chunkAccum, chunkItem) => {
					chunkAccum[chunkItem.Id] = chunkItem;
					return chunkAccum;
				}, {});

				result.Failed.forEach(failedResult => {

					/** @type {import('@aws-sdk/client-sqs').SendMessageBatchRequestEntry} */
					const resultInput = resultChunkById[failedResult.Id];

					const correlationId = correlationIdByIndex[failedResult.Id];

					accum.failedCount++;
					accum.outputs.push({
						success: false,
						message: {
							...JSON.parse(resultInput.MessageBody),
							clientCode: resultInput.MessageAttributes['janis-client'].StringValue
						},
						errorMessage: failedResult.Message,
						...(correlationId !== undefined && { correlationId })
					});
				});
			}

			return accum;

		}, baseResults || {
			successCount: 0,
			failedCount: 0,
			outputs: []
		});
	}
};
