'use strict';

const assert = require('assert');
const sinon = require('sinon');
const MicroServiceCall = require('@janiscommerce/microservice-call');

const { WebhookTrigger } = require('../lib');

describe('Webhook Trigger', () => {

	const serviceName = 'MY_SERVICE';
	const clientCode = 'defaultClient';
	const entity = 'order';
	const eventName = 'created';
	const content = { id: 'd555345345345as67a342a' };
	const contentString = '{"id":"d555345345345as67a342a"}';

	let env;
	const ensureEnvVar = value => {
		env = { ...process.env };
		process.env.JANIS_SERVICE_NAME = value;
	};

	describe('Validation errors', () => {

		beforeEach(() => {
			ensureEnvVar(serviceName);
		});

		afterEach(() => {
			process.env = { ...env };
		});

		it('Should reject if JANIS_SERVICE_NAME environment variable is not set', async () => {
			delete process.env.JANIS_SERVICE_NAME;
			await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, content), /JANIS_SERVICE_NAME/);
		});

		it('Should reject if JANIS_SERVICE_NAME environment variable is an empty string', async () => {
			ensureEnvVar(' ');
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
			ensureEnvVar(serviceName);
			sinon.stub(MicroServiceCall.prototype, 'call');
		});

		afterEach(() => {
			process.env = { ...env };
			sinon.restore();
		});

		const webhooksResponse = {
			SendMessageResponse: {
				ResponseMetadata: {
					RequestId: 'e629f0af-7c92-51aa-bd60-a86ff0c263e8'
				},
				SendMessageResult: {
					MD5OfMessageAttributes: null,
					MD5OfMessageBody: 'e2f6964ff052042abb3718e9f4a431f5',
					MD5OfMessageSystemAttributes: null,
					MessageId: 'ff543ef5-acfa-481b-bcf0-7d50f8372446',
					SequenceNumber: null
				}
			}
		};

		it('Should reject if MicroServiceCall fails', async () => {

			MicroServiceCall.prototype.call.rejects(new Error('Internal error'));

			await assert.rejects(() => WebhookTrigger.send(clientCode, entity, eventName, content), {
				message: 'Internal error'
			});

			sinon.assert.calledOnceWithExactly(MicroServiceCall.prototype.call, 'webhooks', 'event', 'create', {
				clientCode,
				service: serviceName,
				entity,
				eventName,
				content: contentString
			});
		});

		it('Should resolve MicroServiceCall response if no errors occur, without encoding a string content', async () => {

			MicroServiceCall.prototype.call.resolves({
				statusCode: 200,
				body: { ...webhooksResponse }
			});

			const response = await WebhookTrigger.send(clientCode, entity, eventName, contentString);

			assert.deepStrictEqual(response, {
				statusCode: 200,
				body: webhooksResponse
			});

			sinon.assert.calledOnceWithExactly(MicroServiceCall.prototype.call, 'webhooks', 'event', 'create', {
				clientCode,
				service: serviceName,
				entity,
				eventName,
				content: contentString
			});
		});

		it('Should resolve MicroServiceCall response if no errors occur, JSON encoding an object content', async () => {

			MicroServiceCall.prototype.call.resolves({
				statusCode: 200,
				body: { ...webhooksResponse }
			});

			const response = await WebhookTrigger.send(clientCode, entity, eventName, content);

			assert.deepStrictEqual(response, {
				statusCode: 200,
				body: webhooksResponse
			});

			sinon.assert.calledOnceWithExactly(MicroServiceCall.prototype.call, 'webhooks', 'event', 'create', {
				clientCode,
				service: serviceName,
				entity,
				eventName,
				content: contentString
			});
		});
	});

});
