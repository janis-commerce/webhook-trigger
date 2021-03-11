'use strict';

const fs = require('fs');
const YAML = require('js-yaml');
const logger = require('lllog')();

const Registration = require('./registration');

/**
 * @typedef TriggerRegistration
 * @property {string} entity The entity of the trigger
 * @property {string} eventName The name of the entity of the trigger
 */

const RegistrationLambda = triggersPath => async () => {

	logger.info('Reading your triggers...');

	try {
		fs.accessSync(triggersPath, fs.constants.F_OK);
	} catch(e) {
		if(e.code === 'ENOENT')
			return logger.info('Triggers definition file not found. Service does not use webhook triggers');

		throw e;
	}

	const triggersString = fs.readFileSync(triggersPath, 'utf8');

	let triggers;

	try {
		triggers = YAML.load(triggersString);
	} catch(e) {
		logger.error('Invalid triggers definition. It must be a valid YAML');
		throw e;
	}

	try {
		await Registration.register(triggers);
	} catch(e) {
		logger.error(`Failed to subscribe your webhook triggers: ${e.message}`);
		throw e;
	}
};

module.exports = RegistrationLambda;
