'use strict';

const assert = require('assert');
const sinon = require('sinon');

const { SQSClient } = require('@aws-sdk/client-sqs');

const SQS = require('../lib/helpers/sqs');

describe('SQS', () => {

	afterEach(() => sinon.restore());

	describe('sendMessagesBatch()', () => {

		it('Should return default result shape when baseResults is not provided', async () => {

			sinon.stub(SQSClient.prototype, 'send').resolves({});

			const result = await SQS.sendMessagesBatch([
				[{ Id: 'a', MessageBody: '{}', MessageAttributes: { 'janis-client': { StringValue: 'client-1' } } }]
			]);

			assert.deepStrictEqual(result, {
				successCount: 0,
				failedCount: 0,
				outputs: []
			});
		});

		it('Should not include correlationId in the outputs when correlationIdByIndex is not provided (backward-compat)', async () => {

			sinon.stub(SQSClient.prototype, 'send').resolves({
				Successful: [{ Id: '0', MessageId: 'msg-1' }]
			});

			const result = await SQS.sendMessagesBatch([
				[{ Id: '0', MessageBody: '{}', MessageAttributes: { 'janis-client': { StringValue: 'client-1' } } }]
			]);

			assert.deepStrictEqual(result, {
				successCount: 1,
				failedCount: 0,
				outputs: [{ success: true, messageId: 'msg-1' }]
			});
		});

		it('Should echo the correlationId in successful outputs when provided, only for entries that have one', async () => {

			sinon.stub(SQSClient.prototype, 'send').resolves({
				Successful: [
					{ Id: '0', MessageId: 'msg-1' },
					{ Id: '1', MessageId: 'msg-2' }
				]
			});

			const result = await SQS.sendMessagesBatch([
				[
					{ Id: '0', MessageBody: '{}', MessageAttributes: { 'janis-client': { StringValue: 'client-1' } } },
					{ Id: '1', MessageBody: '{}', MessageAttributes: { 'janis-client': { StringValue: 'client-1' } } }
				]
			], undefined, { 0: 'corr-1' });

			assert.deepStrictEqual(result, {
				successCount: 2,
				failedCount: 0,
				outputs: [
					{ success: true, messageId: 'msg-1', correlationId: 'corr-1' },
					{ success: true, messageId: 'msg-2' }
				]
			});
		});

		it('Should echo the correlationId in failed outputs when provided', async () => {

			sinon.stub(SQSClient.prototype, 'send').resolves({
				Failed: [{ Id: '0', Message: 'SDK Error' }]
			});

			const result = await SQS.sendMessagesBatch([
				[{
					Id: '0',
					MessageBody: JSON.stringify({ entity: 'order' }),
					MessageAttributes: { 'janis-client': { StringValue: 'client-1' } }
				}]
			], undefined, { 0: 'corr-err-1' });

			assert.deepStrictEqual(result, {
				successCount: 0,
				failedCount: 1,
				outputs: [{
					success: false,
					message: { entity: 'order', clientCode: 'client-1' },
					errorMessage: 'SDK Error',
					correlationId: 'corr-err-1'
				}]
			});
		});
	});
});
