'use strict';

const sinon = require('sinon');

const { Invoker } = require('@janiscommerce/lambda');

const { SyncWebhookSubscriptionsConsumer } = require('../lib');
const ClientModel = require('../lib/helpers/client-model');

describe('SyncWebhookSubscriptionsConsumer', () => {

	const serviceName = 'MY_SERVICE';
	const clientCode = 'defaultClient';
	const messageId = 'msg-123456';
	const triggersEvents = ['MY_SERVICE:order:created'];

	let env;
	let handler;
	let logger;
	let consumer;

	const buildRecord = body => ({ messageId, body });

	beforeEach(() => {
		env = { ...process.env };
		process.env.JANIS_SERVICE_NAME = serviceName;

		handler = { addFailedMessage: sinon.stub() };
		logger = { info: sinon.stub(), error: sinon.stub() };
		consumer = new SyncWebhookSubscriptionsConsumer(handler);
	});

	afterEach(() => {
		process.env = { ...env };
		sinon.restore();
	});

	it('Should reconsolidate the client subscriptions invoking the lambda and overwrite the local copy', async () => {

		sinon.stub(Invoker, 'serviceClientCall').resolves({ statusCode: 200, payload: { triggersIds: ['id'], triggersEvents } });
		sinon.stub(ClientModel, 'updateSubscriptions').resolves();

		await consumer.processSingleRecord(buildRecord({ clientCode, triggersEvents: [], source: 'subscription-save' }), logger);

		sinon.assert.calledOnceWithExactly(
			Invoker.serviceClientCall,
			'webhooks',
			'ClientTriggersSubscriptions',
			clientCode,
			{ serviceCode: serviceName }
		);
		sinon.assert.calledOnceWithExactly(ClientModel.updateSubscriptions, clientCode, triggersEvents);
		sinon.assert.notCalled(handler.addFailedMessage);
	});

	it('Should persist an empty array when the client has no active subscriptions', async () => {

		sinon.stub(Invoker, 'serviceClientCall').resolves({ statusCode: 200, payload: { triggersIds: [], triggersEvents: [] } });
		sinon.stub(ClientModel, 'updateSubscriptions').resolves();

		await consumer.processSingleRecord(buildRecord({ clientCode, triggersEvents: [], source: 'client-created' }), logger);

		sinon.assert.calledOnceWithExactly(ClientModel.updateSubscriptions, clientCode, []);
		sinon.assert.notCalled(handler.addFailedMessage);
	});

	it('Should discard the record without marking a batch failure when the body has no clientCode', async () => {

		const invokerStub = sinon.stub(Invoker, 'serviceClientCall');
		const updateStub = sinon.stub(ClientModel, 'updateSubscriptions');

		await consumer.processSingleRecord(buildRecord({ source: 'backfill' }), logger);

		sinon.assert.calledOnce(logger.error);
		sinon.assert.notCalled(invokerStub);
		sinon.assert.notCalled(updateStub);
		sinon.assert.notCalled(handler.addFailedMessage);
	});

	it('Should discard the record when there is no body at all', async () => {

		const invokerStub = sinon.stub(Invoker, 'serviceClientCall');

		await consumer.processSingleRecord({ messageId }, logger);

		sinon.assert.notCalled(invokerStub);
		sinon.assert.notCalled(handler.addFailedMessage);
	});

	it('Should mark the record as failed when the lambda invocation fails', async () => {

		sinon.stub(Invoker, 'serviceClientCall').rejects(new Error('Invocation failed'));
		const updateStub = sinon.stub(ClientModel, 'updateSubscriptions');

		await consumer.processSingleRecord(buildRecord({ clientCode }), logger);

		sinon.assert.notCalled(updateStub);
		sinon.assert.calledOnceWithExactly(handler.addFailedMessage, messageId);
	});

	it('Should mark the record as failed when the lambda response has no valid triggersEvents', async () => {

		sinon.stub(Invoker, 'serviceClientCall').resolves({ statusCode: 200, functionError: 'Unhandled', payload: { errorMessage: 'boom' } });
		const updateStub = sinon.stub(ClientModel, 'updateSubscriptions');

		await consumer.processSingleRecord(buildRecord({ clientCode }), logger);

		sinon.assert.notCalled(updateStub);
		sinon.assert.calledOnceWithExactly(handler.addFailedMessage, messageId);
	});

	it('Should mark the record as failed when the subscriptions write fails', async () => {

		sinon.stub(Invoker, 'serviceClientCall').resolves({ statusCode: 200, payload: { triggersIds: [], triggersEvents } });
		sinon.stub(ClientModel, 'updateSubscriptions').rejects(new Error('Mongo down'));

		await consumer.processSingleRecord(buildRecord({ clientCode }), logger);

		sinon.assert.calledOnceWithExactly(handler.addFailedMessage, messageId);
	});
});
