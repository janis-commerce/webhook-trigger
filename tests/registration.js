'use strict';

const assert = require('assert');
const sinon = require('sinon');
const { Invoker } = require('@janiscommerce/lambda');

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
			sinon.stub(Invoker, 'serviceCall');
		});

		afterEach(() => {
			process.env = { ...env };
			sinon.restore();
		});

		it('Should reject if Lambda invoker fails', async () => {

			Invoker.serviceCall.rejects(new Error('Internal error'));

			await assert.rejects(() => Registration.register(triggers), {
				message: 'Internal error'
			});

			sinon.assert.calledOnceWithExactly(Invoker.serviceCall, 'webhooks', 'RegisterServiceTriggers', {
				serviceCode: serviceName,
				triggers
			});
		});

		it('Should resolve MicroServiceCall response if no errors occur, without encoding a string content', async () => {

			Invoker.serviceCall.resolves({
				statusCode: 200,
				payload: {}
			});

			const response = await Registration.register(triggers);

			assert.deepStrictEqual(response, {
				statusCode: 200,
				payload: {}
			});

			sinon.assert.calledOnceWithExactly(Invoker.serviceCall, 'webhooks', 'RegisterServiceTriggers', {
				serviceCode: serviceName,
				triggers
			});
		});
	});

});
