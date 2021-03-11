# Webhook Trigger

![Build Status](https://github.com/janis-commerce/webhook-trigger/workflows/Build%20Status/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/janis-commerce/webhook-trigger/badge.svg?branch=master)](https://coveralls.io/github/janis-commerce/webhook-trigger?branch=master)
[![npm version](https://badge.fury.io/js/%40janiscommerce%2Fwebhook-trigger.svg)](https://www.npmjs.com/package/@janiscommerce/webhook-trigger)

A wrapper for webhooks integration

## :inbox_tray: Installation

```sh
npm install @janiscommerce/webhook-trigger
```

## :hammer: Usage

> **IMPORTANT**
> The `JANIS_SERVICE_NAME` environment variable is required to be set as the current service code.

### Service registration

Service registration is the process where a service publishes its triggers so the user can create a Webhook subscription for them.

First of all, you need to create a triggers YAML definition file. The recommended path is `./webhooks/triggers.yml`.

This file **must** have the following structure:

```yaml
- entity: entity-name
  eventName: some-event
- entity: other-entity-name
  eventName: other-event
```

Every event that your service triggers **must** be declared here so users can subscribe to it.

To implement the subscription for your service, simply create the registration lambda with the following content:

```js
// In src/lambda/WebhookTriggersRegistration/index.js
'use strict';

const path = require('path');
const { RegistrationLambda } = require('@janiscommerce/webhook-trigger');

module.exports.handler = RegistrationLambda(path.join(__dirname, '../../../webhooks/triggers.yml'));
```

> **IMPORTANT**: Validate that the path to your triggers definition file is correct!

Then, add your lambda function serverless config file. If you are using [serverless-helper](https://www.npmjs.com/package/serverless-helper) here is the function definition:

```json
["function", {
	"functionName": "WebhookTriggersRegistration",
	"handler": "src/lambda/WebhookTriggersRegistration/index.handler",
	"description": "Webhook Triggers Registration"
}]
```

Then you can test your registration by executing the following:

```sh
npx sls invoke local -f WebhookTriggersRegistration
```

Once you have everything validated, you **should** include this invocation in you CI/CD pipeline:

```sh
aws lambda invoke --function-name <ServiceName>-<stage>-WebhookTriggersRegistration output --log-type Tail --query 'LogResult' --output text | base64 -d
```

> If you want to register your triggers in a different way, the `Registration` class is also exported by this package.

### Event triggering

Every time an event happen, you have to trigger it. For that you need to provide the `clientCode`, `entity` and `eventName` associated to the event.
Additionally, you **must** provide the `content` of the event hook. This content **must** be a string of approximately less than 240Kb. In case you provide an object instead if a string, it will be JSON encoded for you. This content will be the request body that will be sent to the subscribers.

The `WebhookTrigger.send` signature is the following:

```js
interface WebhookResponse {
	statusCode: number;
	body: object;
}

WebhookTrigger.send(clientCode: string, entity: string, eventName: string, content: string | object): Promise<WebhookResponse>;
```

## :computer: Examples

> Send a webhook when an order is created

```js
const WebhookTrigger = require('@janiscommerce/webhook-trigger');

await WebhookTrigger.send('currentClientCode', 'order', 'created', {
	id: 'd555345345345as67a342a',
	dateCreated: new Date(),
	amount: 10.40
});
```
