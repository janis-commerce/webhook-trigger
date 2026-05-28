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
	});
});
