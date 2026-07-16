'use strict';

const logger = require('lllog')();

const ClientModel = require('./client-model');

/**
 * Checks whether a client is subscribed to a given event, against the locally synced subscriptions copy.
 *
 * Fail-open: if the client has no synced subscriptions (`undefined`) or the read fails
 * (client not found, host model absent, Mongo error), the event is emitted anyway.
 *
 * @param {string} clientCode The Janis Client code
 * @param {string} entity The name of the entity associated to this trigger
 * @param {string} eventName The name of the event associated to this trigger
 * @returns {Promise<boolean>} Whether the event should be emitted
 */
module.exports = async (clientCode, entity, eventName) => {

	let subscriptions;

	try {
		subscriptions = await ClientModel.getSubscriptions(clientCode);
	} catch(error) {
		logger.error('Failed to read webhook subscriptions, emitting anyway (fail-open)', { clientCode, errorMessage: error.message });
		return true;
	}

	if(subscriptions === undefined) {
		logger.info('Client has no synced webhook subscriptions, emitting anyway (fail-open)', { clientCode });
		return true;
	}

	const eventKey = `${process.env.JANIS_SERVICE_NAME}:${entity}:${eventName}`;

	return subscriptions.includes(eventKey);
};
