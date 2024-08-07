'use strict';

const assert = require('assert');
const sinon = require('sinon');
const { mockClient } = require('aws-sdk-client-mock');
const { SQSClient, SendMessageBatchCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');

const { WebhookTrigger } = require('../lib');

describe('Webhook Trigger', () => {

	const defaultQueueUrl = 'https://sqs.us-east-1.amazonaws.com/000000000000/WebhookEvents';
	const serviceName = 'MY_SERVICE';
	const clientCode = 'defaultClient';
	const entity = 'order';
	const eventName = 'created';
	const content = { id: 'd555345345345as67a342a' };
	const contentString = '{"id":"d555345345345as67a342a"}';

	let env;
	const ensureEnvVars = value => {
		env = { ...process.env };
		process.env.JANIS_SERVICE_NAME = value;
		process.env.JANIS_WEBHOOKS_QUEUE_URL = defaultQueueUrl;
	};

	describe('send()', () => {

		describe('Validation errors', () => {

			beforeEach(() => {
				ensureEnvVars(serviceName);
			});

			afterEach(() => {
				process.env = { ...env };
			});

			it('Should reject if JANIS_WEBHOOKS_QUEUE_URL environment variable is not set', async () => {
				delete process.env.JANIS_WEBHOOKS_QUEUE_URL;
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, content), /JANIS_WEBHOOKS_QUEUE_URL/);
			});

			it('Should reject if JANIS_SERVICE_NAME environment variable is not set', async () => {
				delete process.env.JANIS_SERVICE_NAME;
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, content), /JANIS_SERVICE_NAME/);
			});

			it('Should reject if JANIS_SERVICE_NAME environment variable is an empty string', async () => {
				ensureEnvVars('');
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, content), /JANIS_SERVICE_NAME/);
			});

			it('Should reject if clientCode is not a string', async () => {
				await assert.rejects(() => WebhookTrigger.send(['invalid'], entity, eventName, content), /clientCode/);
			});

			it('Should reject if clientCode is an empty string', async () => {
				await assert.rejects(() => WebhookTrigger.send(' ', entity, eventName, content), /clientCode/);
			});

			it('Should reject if entity is not a string', async () => {
				await assert.rejects(() => WebhookTrigger.send(clientCode, ['invalid'], eventName, content), /entity/);
			});

			it('Should reject if entity is an empty string', async () => {
				await assert.rejects(() => WebhookTrigger.send(clientCode, ' ', eventName, content), /entity/);
			});

			it('Should reject if eventName is not a string', async () => {
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, ['invalid'], content), /eventName/);
			});

			it('Should reject if eventName is an empty string', async () => {
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, ' ', content), /eventName/);
			});

			it('Should reject if content is empty', async () => {
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, null), /content/);
			});

			it('Should reject if content is an empty string', async () => {
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, ' '), /content/);
			});

			it('Should reject if content is not a string or an object', async () => {
				await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, 100), /content/);
			});
		});

		describe('Processing', () => {

			beforeEach(() => {
				ensureEnvVars(serviceName);
				this.SQSClientMock = mockClient(SQSClient);
			});

			afterEach(() => {
				process.env = { ...env };
				this.SQSClientMock.restore();
				sinon.restore();
			});

			const assertAwsSdkCall = (command, expectedArguments) => {

				const expectedArgumentsArray = Array.isArray(expectedArguments) ? expectedArguments : [expectedArguments];
				const commandCalls = this.SQSClientMock.commandCalls(command);

				// eslint-disable-next-line max-len
				assert.strictEqual(commandCalls?.length, expectedArgumentsArray.length, `${command.name} was expected to be called ${expectedArgumentsArray.length} time${expectedArgumentsArray.length > 1 ? 's' : ''} but was called ${commandCalls?.length || 0} times`);

				expectedArgumentsArray.forEach((expectedArgument, index) => {

					const actualArgument = commandCalls[index].args[0]?.input;

					assert.deepStrictEqual(actualArgument, expectedArgument, `Unexpected argument number ${index} of ${command.name} call`);

				});
			};

			const queueResponse = {
				MD5OfMessageAttributes: null,
				MD5OfMessageBody: 'e2f6964ff052042abb3718e9f4a431f5',
				MD5OfMessageSystemAttributes: null,
				MessageId: 'ff543ef5-acfa-481b-bcf0-7d50f8372446',
				SequenceNumber: null
			};

			it('Should resolve the failed result if it fails to send the event to the queue', async () => {

				this.SQSClientMock.on(SendMessageCommand).rejects(new Error('SDK Error'));

				const response = await WebhookTrigger.send(clientCode, entity, eventName, content);

				assert.deepStrictEqual(response, {
					success: false,
					message: {
						clientCode,
						service: serviceName,
						entity,
						eventName,
						content: contentString
					},
					errorMessage: 'SDK Error'
				});

				assertAwsSdkCall(SendMessageCommand, {
					QueueUrl: defaultQueueUrl,
					MessageBody: JSON.stringify({
						service: serviceName,
						entity,
						eventName,
						content: contentString
					}),
					MessageAttributes: {
						'janis-client': {
							DataType: 'String',
							StringValue: clientCode
						}
					}
				});
			});

			it('Should resolve the successful result if it sends the event to the queue (with string-typed content)', async () => {

				this.SQSClientMock.on(SendMessageCommand).resolves(queueResponse);

				const response = await WebhookTrigger.send(clientCode, entity, eventName, contentString);

				assert.deepStrictEqual(response, {
					success: true,
					messageId: queueResponse.MessageId
				});

				assertAwsSdkCall(SendMessageCommand, {
					QueueUrl: defaultQueueUrl,
					MessageBody: JSON.stringify({
						service: serviceName,
						entity,
						eventName,
						content: contentString
					}),
					MessageAttributes: {
						'janis-client': {
							DataType: 'String',
							StringValue: clientCode
						}
					}
				});
			});

			it('Should resolve the successful result if it sends the event to the queue (with object-typed content)', async () => {

				this.SQSClientMock.on(SendMessageCommand).resolves(queueResponse);

				const response = await WebhookTrigger.send(clientCode, entity, eventName, content);

				assert.deepStrictEqual(response, {
					success: true,
					messageId: queueResponse.MessageId
				});

				assertAwsSdkCall(SendMessageCommand, {
					QueueUrl: defaultQueueUrl,
					MessageBody: JSON.stringify({
						service: serviceName,
						entity,
						eventName,
						content: contentString
					}),
					MessageAttributes: {
						'janis-client': {
							DataType: 'String',
							StringValue: clientCode
						}
					}
				});
			});
		});
	});

	describe('sendBatch()', () => {

		describe('Validation errors', () => {

			beforeEach(() => {
				ensureEnvVars(serviceName);
			});

			afterEach(() => {
				process.env = { ...env };
			});

			it('Should reject if JANIS_WEBHOOKS_QUEUE_URL environment variable is not set', async () => {
				delete process.env.JANIS_WEBHOOKS_QUEUE_URL;
				await assert.rejects(() => WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content }]), /JANIS_WEBHOOKS_QUEUE_URL/);
			});

			it('Should reject if JANIS_SERVICE_NAME environment variable is not set', async () => {
				delete process.env.JANIS_SERVICE_NAME;
				await assert.rejects(() => WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content }]), /JANIS_SERVICE_NAME/);
			});

			it('Should reject if JANIS_SERVICE_NAME environment variable is an empty string', async () => {
				ensureEnvVars('');
				await assert.rejects(() => WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content }]), /JANIS_SERVICE_NAME/);
			});

			it('Should reject if events is not an array', async () => {
				await assert.rejects(() => WebhookTrigger.sendBatch({ clientCode, entity, eventName, content }), /Expected an array of events/);
			});

			it('Should reject if clientCode is not a string', async () => {

				const result = await WebhookTrigger.sendBatch([{ clientCode: ['invalid'], entity, eventName, content }]);

				assert.deepStrictEqual(result, {
					successCount: 0,
					errorCount: 1,
					outputs: [
						{
							success: false,
							message: {
								clientCode: ['invalid'],
								entity,
								eventName,
								content
							},
							errorMessage: 'Invalid clientCode. Expected string but received [ \'invalid\' ]'
						}
					]
				});
			});

			it('Should reject if entity is not a string', async () => {

				const result = await WebhookTrigger.sendBatch([{ clientCode, entity: ['invalid'], eventName, content }]);

				assert.deepStrictEqual(result, {
					successCount: 0,
					errorCount: 1,
					outputs: [
						{
							success: false,
							message: {
								clientCode,
								entity: ['invalid'],
								eventName,
								content
							},
							errorMessage: 'Invalid entity. Expected string but received [ \'invalid\' ]'
						}
					]
				});
			});

			it('Should reject if eventName is not a string', async () => {

				const result = await WebhookTrigger.sendBatch([{ clientCode, entity, eventName: ['invalid'], content }]);

				assert.deepStrictEqual(result, {
					successCount: 0,
					errorCount: 1,
					outputs: [
						{
							success: false,
							message: {
								clientCode,
								entity,
								eventName: ['invalid'],
								content
							},
							errorMessage: 'Invalid eventName. Expected string but received [ \'invalid\' ]'
						}
					]
				});
			});

			it('Should reject if content is empty', async () => {

				const result = await WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content: null }]);

				assert.deepStrictEqual(result, {
					successCount: 0,
					errorCount: 1,
					outputs: [
						{
							success: false,
							message: {
								clientCode,
								entity,
								eventName,
								content: null
							},
							errorMessage: 'Invalid content. Expected string | object but received null'
						}
					]
				});
			});

			it('Should reject if content is not a string or an object', async () => {

				const result = await WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content: 100 }]);

				assert.deepStrictEqual(result, {
					successCount: 0,
					errorCount: 1,
					outputs: [
						{
							success: false,
							message: {
								clientCode,
								entity,
								eventName,
								content: 100
							},
							errorMessage: 'Invalid content. Expected string | object but received 100'
						}
					]
				});
			});
		});

		describe('Processing', () => {

			beforeEach(() => {
				ensureEnvVars(serviceName);
				this.SQSClientMock = mockClient(SQSClient);
			});

			afterEach(() => {
				process.env = { ...env };
				this.SQSClientMock.restore();
				sinon.restore();
			});

			const assertAwsSdkCall = (command, expectedArguments) => {

				const expectedArgumentsArray = Array.isArray(expectedArguments) ? expectedArguments : [expectedArguments];
				const commandCalls = this.SQSClientMock.commandCalls(command);

				// eslint-disable-next-line max-len
				assert.strictEqual(commandCalls?.length, expectedArgumentsArray.length, `${command.name} was expected to be called ${expectedArgumentsArray.length} time${expectedArgumentsArray.length > 1 ? 's' : ''} but was called ${commandCalls?.length || 0} times`);

				expectedArgumentsArray.forEach((expectedArgument, index) => {

					const actualArgument = commandCalls[index].args[0]?.input;

					assert.deepStrictEqual(actualArgument, expectedArgument, `Unexpected argument number ${index} of ${command.name} call`);

				});
			};

			const queueResponse = {
				Successful: [{
					MD5OfMessageAttributes: null,
					MD5OfMessageBody: 'e2f6964ff052042abb3718e9f4a431f5',
					MD5OfMessageSystemAttributes: null,
					MessageId: 'ff543ef5-acfa-481b-bcf0-7d50f8372446',
					SequenceNumber: null
				}]
			};

			it('Should resolve the failed result if it fails to send the event to the queue', async () => {

				this.SQSClientMock.on(SendMessageBatchCommand).resolves({
					Failed: [{
						Id: '0',
						Message: 'SDK Error'
					}]
				});

				const response = await WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content }]);

				assert.deepStrictEqual(response, {
					successCount: 0,
					errorCount: 1,
					outputs: [{
						success: false,
						message: {
							clientCode,
							service: serviceName,
							entity,
							eventName,
							content: contentString
						},
						errorMessage: 'SDK Error'
					}]
				});

				assertAwsSdkCall(SendMessageBatchCommand, {
					QueueUrl: defaultQueueUrl,
					Entries: [{
						Id: '0',
						MessageBody: JSON.stringify({
							service: serviceName,
							entity,
							eventName,
							content: contentString
						}),
						MessageAttributes: {
							'janis-client': {
								DataType: 'String',
								StringValue: clientCode
							}
						}
					}]
				});
			});

			it('Should resolve the successful result if it sends the event to the queue (with string-typed content)', async () => {

				this.SQSClientMock.on(SendMessageBatchCommand).resolves(queueResponse);

				const response = await WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content: contentString }]);

				assert.deepStrictEqual(response, {
					successCount: 1,
					errorCount: 0,
					outputs: [{
						success: true,
						messageId: queueResponse.Successful[0].MessageId
					}]
				});

				assertAwsSdkCall(SendMessageBatchCommand, {
					QueueUrl: defaultQueueUrl,
					Entries: [{
						Id: '0',
						MessageBody: JSON.stringify({
							service: serviceName,
							entity,
							eventName,
							content: contentString
						}),
						MessageAttributes: {
							'janis-client': {
								DataType: 'String',
								StringValue: clientCode
							}
						}
					}]
				});
			});

			it('Should resolve the successful result if it sends the event to the queue (with object-typed content)', async () => {

				this.SQSClientMock.on(SendMessageBatchCommand).resolves(queueResponse);

				const response = await WebhookTrigger.sendBatch([{ clientCode, entity, eventName, content }]);

				assert.deepStrictEqual(response, {
					successCount: 1,
					errorCount: 0,
					outputs: [{
						success: true,
						messageId: queueResponse.Successful[0].MessageId
					}]
				});

				assertAwsSdkCall(SendMessageBatchCommand, {
					QueueUrl: defaultQueueUrl,
					Entries: [{
						Id: '0',
						MessageBody: JSON.stringify({
							service: serviceName,
							entity,
							eventName,
							content: contentString
						}),
						MessageAttributes: {
							'janis-client': {
								DataType: 'String',
								StringValue: clientCode
							}
						}
					}]
				});
			});

			it('Should allow to send more than 10 events in a batch and report each of them', async () => {

				this.SQSClientMock.on(SendMessageBatchCommand)
					.resolvesOnce({
						Successful: new Array(10).fill(queueResponse.Successful[0])
					})
					.resolvesOnce({
						Successful: new Array(5).fill(queueResponse.Successful[0])
					});

				const response = await WebhookTrigger.sendBatch(new Array(15).fill({ clientCode, entity, eventName, content }));

				assert.deepStrictEqual(response, {
					successCount: 15,
					errorCount: 0,
					outputs: new Array(15).fill({
						success: true,
						messageId: queueResponse.Successful[0].MessageId
					})
				});

				const baseMessage = {
					Id: '0',
					MessageBody: JSON.stringify({
						service: serviceName,
						entity,
						eventName,
						content: contentString
					}),
					MessageAttributes: {
						'janis-client': {
							DataType: 'String',
							StringValue: clientCode
						}
					}
				};

				assertAwsSdkCall(SendMessageBatchCommand, [
					{
						QueueUrl: defaultQueueUrl,
						Entries: new Array(10).fill(baseMessage)
							.map((entry, index) => ({
								...entry,
								Id: index.toString()
							}))
					},
					{
						QueueUrl: defaultQueueUrl,
						Entries: new Array(5).fill(baseMessage)
							.map((entry, index) => ({
								...entry,
								Id: (index + 10).toString()
							}))
					}
				]);
			});

			it('Should report a mixed result with successful and failed events', async () => {

				this.SQSClientMock.on(SendMessageBatchCommand).resolves({
					Successful: [{
						MD5OfMessageAttributes: null,
						MD5OfMessageBody: 'e2f6964ff052042abb3718e9f4a431f5',
						MD5OfMessageSystemAttributes: null,
						MessageId: 'ff543ef5-acfa-481b-bcf0-7d50f8372446',
						SequenceNumber: null
					}],
					Failed: [{
						Id: '1',
						Message: 'SDK Error'
					}]
				});

				const response = await WebhookTrigger.sendBatch([
					{ clientCode, entity, eventName, content },
					{ clientCode, entity, eventName, content }
				]);

				assert.deepStrictEqual(response, {
					successCount: 1,
					errorCount: 1,
					outputs: [
						{
							success: true,
							messageId: queueResponse.Successful[0].MessageId
						},
						{
							success: false,
							message: {
								clientCode,
								service: serviceName,
								entity,
								eventName,
								content: contentString
							},
							errorMessage: 'SDK Error'
						}
					]
				});

				assertAwsSdkCall(SendMessageBatchCommand, {
					QueueUrl: defaultQueueUrl,
					Entries: [
						{
							Id: '0',
							MessageBody: JSON.stringify({
								service: serviceName,
								entity,
								eventName,
								content: contentString
							}),
							MessageAttributes: {
								'janis-client': {
									DataType: 'String',
									StringValue: clientCode
								}
							}
						}, {
							Id: '1',
							MessageBody: JSON.stringify({
								service: serviceName,
								entity,
								eventName,
								content: contentString
							}),
							MessageAttributes: {
								'janis-client': {
									DataType: 'String',
									StringValue: clientCode
								}
							}
						}
					]
				});
			});
		});
	});

});
