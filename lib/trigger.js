'use strict';

const MicroserviceCall = require('@janiscommerce/microservice-call');
const Validator = require('./validator');

/**
 * @typedef WebhookResponse
 * @property {number} statusCode The response HTTP status code from the Webhooks Service
 * @property {object} body The response body from the Webhooks Service
 */

module.exports = class WebhookTrigger {

	/**
	 * Send a webhook trigger
	 *
	 * @param {string} clientCode The Janis Client code
	 * @param {string} entity The name of the entity associated to this trigger
	 * @param {string} eventName The name of the event associated to this trigger
	 * @param {string|object} content The content of the trigger. If it's not a string it will be JSON encoded
	 * @throws If call to the webhook service fails
	 */
	static async send(clientCode, entity, eventName, content) {

		Validator.validateEvent(clientCode, entity, eventName, content);

		const microserviceCall = new MicroserviceCall();
		return microserviceCall.call('webhooks', 'event', 'create', {
			clientCode,
			service: process.env.JANIS_SERVICE_NAME,
			entity,
			eventName,
			content: typeof content === 'string' ? content : JSON.stringify(content)
		});
	}

};
