'use strict';

const Registration = require('./registration');
const RegistrationLambda = require('./registration-lambda');
const WebhookTrigger = require('./trigger');

module.exports = {
	WebhookTrigger,
	Registration,
	RegistrationLambda
};
