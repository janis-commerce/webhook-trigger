'use strict';

const assert = require('assert');
const sinon = require('sinon');
const loggerFactory = require('lllog');

const hasSubscription = require('../../lib/helpers/has-subscription');
const ClientModel = require('../../lib/helpers/client-model');

describe('helpers/has-subscription', () => {

	const clientCode = 'defaultClient';
	const entity = 'order';
	const eventName = 'created';
	const serviceName = 'MY_SERVICE';

	// All lllog() instances share the same Logger.prototype, including the module-level logger in has-subscription.js
	const loggerPrototype = Object.getPrototypeOf(loggerFactory());

	let env;

	beforeEach(() => {
		env = { ...process.env };
		process.env.JANIS_SERVICE_NAME = serviceName;
	});

	afterEach(() => {
		process.env = { ...env };
		sinon.restore();
	});

	const eventKey = `${serviceName}:${entity}:${eventName}`;

	it('Should return true when the client is subscribed to the event', async () => {

		sinon.stub(ClientModel, 'getSubscriptions').resolves(new Set([eventKey]));

		const result = await hasSubscription(clientCode, entity, eventName);

		assert.strictEqual(result, true);
	});

	it('Should return false when the client is not subscribed to the event', async () => {

		sinon.stub(ClientModel, 'getSubscriptions').resolves(new Set([`${serviceName}:other:event`]));

		const result = await hasSubscription(clientCode, entity, eventName);

		assert.strictEqual(result, false);
	});

	it('Should fail-open, warn and return true when the client has no synced subscriptions (undefined)', async () => {

		sinon.stub(ClientModel, 'getSubscriptions').resolves(undefined);
		sinon.stub(loggerPrototype, 'warn');

		const result = await hasSubscription(clientCode, entity, eventName);

		assert.strictEqual(result, true);
		sinon.assert.calledOnceWithExactly(
			loggerPrototype.warn,
			'Client has no synced webhook subscriptions, emitting anyway (fail-open)',
			{ clientCode }
		);
	});

	it('Should fail-open, log an error and return true when the subscriptions read fails', async () => {

		const error = new Error('Mongo down');

		sinon.stub(ClientModel, 'getSubscriptions').rejects(error);
		sinon.stub(loggerPrototype, 'error');

		const result = await hasSubscription(clientCode, entity, eventName);

		assert.strictEqual(result, true);
		sinon.assert.calledOnceWithExactly(
			loggerPrototype.error,
			'Failed to read webhook subscriptions, emitting anyway (fail-open)',
			{ clientCode, errorMessage: error.message }
		);
	});
});
