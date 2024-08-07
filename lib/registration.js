'use strict';

const { Invoker } = require('@janiscommerce/lambda');

const Validator = require('./validator');

/**
 * @typedef TriggerRegistration
 * @property {string} entity The entity of the trigger
 * @property {string} eventName The name of the entity of the trigger
 */

module.exports = class Registration {

	/**
	 * Register a service triggers
	 *
	 * @param {Array<TriggerRegistration>} triggers All the triggers of this service
	 * @throws If call to the webhook service fails
	 */
	static async register(triggers) {

		Validator.validateTriggers(triggers);

		return Invoker.serviceCall('webhooks', 'RegisterServiceTriggers', {
			serviceCode: process.env.JANIS_SERVICE_NAME,
			triggers
		});
	}

};
