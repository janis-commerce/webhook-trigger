/* eslint-disable no-template-curly-in-string */

'use strict';

module.exports = () => {

	let webhooksQueueArn;

	if(process.env.JANIS_WEBHOOKS_QUEUE_URL) {
		const [, , domain, accountId, queueName] = process.env.JANIS_WEBHOOKS_QUEUE_URL.split('/');
		const [, region] = domain.split('.');
		webhooksQueueArn = `arn:aws:sqs:${region}:${accountId}:${queueName}`;
	}

	if(!webhooksQueueArn)
		return [];

	return [
		['envVars', {
			JANIS_WEBHOOKS_QUEUE_URL: '${env:JANIS_WEBHOOKS_QUEUE_URL}'
		}],
		['iamStatement', {
			action: 'sqs:SendMessage',
			resource: webhooksQueueArn
		}]
	];
};
