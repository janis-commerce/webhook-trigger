'use strict';

// eslint-disable-next-line import/no-extraneous-dependencies
const { SQSClient, SendMessageCommand, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const AsyncWithConcurrency = require('./async-with-concurrency');

/**
 * @typedef SendMessageSuccess
 * @property {true} success
 * @property {string} messageId
 */

/**
 * @typedef SendMessageError
 * @property {false} success
 * @property {object} message
 * @property {string} errorMessage
 */

/**
 * @typedef SendMessageBatchResult
 * @property {number} successCount
 * @property {number} failedCount
 * @property {SendMessageSuccess[]|SendMessageError[]} outputs
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
	 * @returns {Promise<SendMessageBatchResult>}
	 */
	static async sendMessagesBatch(chunks, baseResults, maxConcurrency = DEFAULT_MAX_CONCURRENCY) {

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
					accum.successCount++;
					accum.outputs.push({
						success: true,
						messageId: successfulResult.MessageId
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

					accum.errorCount++;
					accum.outputs.push({
						success: false,
						message: {
							...JSON.parse(resultInput.MessageBody),
							clientCode: resultInput.MessageAttributes['janis-client'].StringValue
						},
						errorMessage: failedResult.Message
					});
				});
			}

			return accum;

		}, baseResults || {
			successCount: 0,
			errorCount: 0,
			outputs: []
		});
	}
};
