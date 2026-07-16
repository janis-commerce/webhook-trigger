'use strict';

const assert = require('assert');
const path = require('path');
const sinon = require('sinon');
const mockRequire = require('mock-require');

const ClientModel = require('../../lib/helpers/client-model');

describe('helpers/client-model', () => {

	const clientCode = 'defaultClient';
	const subscriptions = ['MY_SERVICE:order:created'];
	const modelPath = path.join(process.cwd(), 'models', 'client');

	afterEach(() => {
		ClientModel.clearCache();
		mockRequire.stopAll();
		sinon.restore();
	});

	describe('getModel()', () => {

		it('Should resolve the host service client model and memoize the instance', () => {

			let instantiations = 0;
			const FakeModel = class {
				constructor() { instantiations++; }
			};

			mockRequire(modelPath, FakeModel);

			const firstInstance = ClientModel.getModel();
			const secondInstance = ClientModel.getModel();

			assert.ok(firstInstance instanceof FakeModel);
			assert.strictEqual(firstInstance, secondInstance);
			assert.strictEqual(instantiations, 1);
		});

		it('Should throw when the host service does not expose a client model', () => {
			assert.throws(() => ClientModel.getModel(), /Unable to load client model/);
		});
	});

	describe('getSubscriptions()', () => {

		it('Should return the client synced subscriptions', async () => {

			const getBy = sinon.stub().resolves([{ code: clientCode, webhookSubscriptions: subscriptions }]);
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			const result = await ClientModel.getSubscriptions(clientCode);

			assert.deepStrictEqual(result, subscriptions);
			sinon.assert.calledOnceWithExactly(getBy, 'code', clientCode, { limit: 1 });
		});

		it('Should return undefined when the client is found but has no synced subscriptions', async () => {

			const getBy = sinon.stub().resolves([{ code: clientCode }]);
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			const result = await ClientModel.getSubscriptions(clientCode);

			assert.strictEqual(result, undefined);
		});

		it('Should throw when the client is not found', async () => {

			const getBy = sinon.stub().resolves([]);
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			await assert.rejects(() => ClientModel.getSubscriptions(clientCode), /Client not found/);
		});

		it('Should propagate the model read error', async () => {

			const getBy = sinon.stub().rejects(new Error('Mongo down'));
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			await assert.rejects(() => ClientModel.getSubscriptions(clientCode), /Mongo down/);
		});

		it('Should read from Mongo once and serve subsequent reads from cache within the TTL', async () => {

			const getBy = sinon.stub().resolves([{ code: clientCode, webhookSubscriptions: subscriptions }]);
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			const firstRead = await ClientModel.getSubscriptions(clientCode);
			const secondRead = await ClientModel.getSubscriptions(clientCode);

			assert.deepStrictEqual(firstRead, subscriptions);
			assert.deepStrictEqual(secondRead, subscriptions);
			sinon.assert.calledOnce(getBy);
		});

		it('Should hit Mongo again after the cache TTL expires', async () => {

			const clock = sinon.useFakeTimers();

			const getBy = sinon.stub().resolves([{ code: clientCode, webhookSubscriptions: subscriptions }]);
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			await ClientModel.getSubscriptions(clientCode);

			clock.tick((5 * 60 * 1000) + 1);

			await ClientModel.getSubscriptions(clientCode);

			sinon.assert.calledTwice(getBy);
		});

		it('Should not cache failed reads (client not found)', async () => {

			const getBy = sinon.stub().resolves([]);
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			await assert.rejects(() => ClientModel.getSubscriptions(clientCode));
			await assert.rejects(() => ClientModel.getSubscriptions(clientCode));

			sinon.assert.calledTwice(getBy);
		});
	});

	describe('updateSubscriptions()', () => {

		it('Should overwrite the client subscriptions without touching the modified data', async () => {

			const update = sinon.stub().resolves(1);
			sinon.stub(ClientModel, 'getModel').returns({ update });

			await ClientModel.updateSubscriptions(clientCode, subscriptions);

			sinon.assert.calledOnceWithExactly(
				update,
				{ webhookSubscriptions: subscriptions },
				{ code: clientCode },
				{ skipAutomaticSetModifiedData: true }
			);
		});
	});

	describe('clearCache()', () => {

		it('Should clear the read cache so the next read hits Mongo again', async () => {

			const getBy = sinon.stub().resolves([{ code: clientCode, webhookSubscriptions: subscriptions }]);
			sinon.stub(ClientModel, 'getModel').returns({ getBy });

			await ClientModel.getSubscriptions(clientCode);

			ClientModel.clearCache();

			await ClientModel.getSubscriptions(clientCode);

			sinon.assert.calledTwice(getBy);
		});
	});
});
