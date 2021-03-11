'use strict';

const assert = require('assert');
const sinon = require('sinon');
const MicroServiceCall = require('@janiscommerce/microservice-call');

const { Registration } = require('../lib');

describe('Service Registration', () => {

	const serviceName = 'MY_SERVICE';
	const entity = 'order';
	const eventName = 'created';

	const triggers = [
		{
			entity,
			eventName
		},
		{
			entity,
			eventName: 'picked'
		}
	];

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
			await assert.rejects(() => Registration.register(triggers), /JANIS_SERVICE_NAME/);
		});

		it('Should reject if JANIS_SERVICE_NAME environment variable is an empty string', async () => {
			ensureEnvVar(' ');
			await assert.rejects(() => Registration.register(triggers), /JANIS_SERVICE_NAME/);
		});

		it('Should reject if triggers are not an array', async () => {
			await assert.rejects(() => Registration.register({ foo: 'bar' }), /triggers/);
		});

		it('Should reject if a trigger is not an object', async () => {
			await assert.rejects(() => Registration.register(['invalid']), /triggers.0/);
		});

		it('Should reject if a trigger has no entity', async () => {
			await assert.rejects(() => Registration.register([{ eventName }]), /triggers.0.entity/);
		});

		it('Should reject if a trigger has an empty string entity', async () => {
			await assert.rejects(() => Registration.register([{ entity: ' ', eventName }]), /triggers.0.entity/);
		});

		it('Should reject if a trigger has a non-string entity', async () => {
			await assert.rejects(() => Registration.register([{ entity: ['invalid'], eventName }]), /triggers.0.entity/);
		});

		it('Should reject if a trigger has no eventName', async () => {
			await assert.rejects(() => Registration.register([{ entity }]), /triggers.0.eventName/);
		});

		it('Should reject if a trigger has an empty string eventName', async () => {
			await assert.rejects(() => Registration.register([{ eventName: ' ', entity }]), /triggers.0.eventName/);
		});

		it('Should reject if a trigger has a non-string eventName', async () => {
			await assert.rejects(() => Registration.register([{ eventName: ['invalid'], entity }]), /triggers.0.eventName/);
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

			await assert.rejects(() => Registration.register(triggers), {
				message: 'Internal error'
			});

			sinon.assert.calledOnceWithExactly(MicroServiceCall.prototype.call, 'webhooks', 'service', 'register', triggers);
		});

		it('Should resolve MicroServiceCall response if no errors occur, without encoding a string content', async () => {

			MicroServiceCall.prototype.call.resolves({
				statusCode: 200,
				body: { ...webhooksResponse }
			});

			const response = await Registration.register(triggers);

			assert.deepStrictEqual(response, {
				statusCode: 200,
				body: webhooksResponse
			});

			sinon.assert.calledOnceWithExactly(MicroServiceCall.prototype.call, 'webhooks', 'service', 'register', triggers);
		});

		it('Should resolve MicroServiceCall response if no errors occur, JSON encoding an object content', async () => {

			MicroServiceCall.prototype.call.resolves({
				statusCode: 200,
				body: { ...webhooksResponse }
			});

			const response = await Registration.register(triggers);

			assert.deepStrictEqual(response, {
				statusCode: 200,
				body: webhooksResponse
			});

			sinon.assert.calledOnceWithExactly(MicroServiceCall.prototype.call, 'webhooks', 'service', 'register', triggers);
		});
	});

});
