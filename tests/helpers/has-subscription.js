'use strict';

const assert = require('assert');
const sinon = require('sinon');

const hasSubscription = require('../../lib/helpers/has-subscription');
const ClientModel = require('../../lib/helpers/client-model');

describe('helpers/has-subscription', () => {

	const clientCode = 'defaultClient';
	const entity = 'order';
	const eventName = 'created';
	const serviceName = 'MY_SERVICE';

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

	it('Should fail-open and return true when the client has no synced subscriptions (undefined)', async () => {

		sinon.stub(ClientModel, 'getSubscriptions').resolves(undefined);

		const result = await hasSubscription(clientCode, entity, eventName);

		assert.strictEqual(result, true);
	});

	it('Should fail-open and return true when the subscriptions read fails', async () => {

		sinon.stub(ClientModel, 'getSubscriptions').rejects(new Error('Mongo down'));

		const result = await hasSubscription(clientCode, entity, eventName);

		assert.strictEqual(result, true);
	});
});
