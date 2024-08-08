'use strict';

const Registration = require('./registration');
const RegistrationLambda = require('./registration-lambda');
const serverlessHelperHooks = require('./serverless-helper-hooks');
const WebhookTrigger = require('./trigger');

module.exports = {
	WebhookTrigger,
	Registration,
	RegistrationLambda,
	serverlessHelperHooks
};
