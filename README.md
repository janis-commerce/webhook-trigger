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
> The `JANIS_WEBHOOKS_QUEUE_URL` environment variable is required to be set as the SQS Queue URL of the Webhooks service.

### Permissions

You need to add permissions to send messages to the Webhooks SQS Queue to your execution role. If you run your service in AWS Lambda with Serverless Helper, you can import and use the `serverlessHelperHooks` function to add proper permissions.

The following is an example of implementation:

```js
const { helper } = require('sls-helper');
const { serverlessHelperHooks } = require('@janiscommerce/webhook-trigger');

module.exports = helper({
	hooks: [
		...serverlessHelperHooks()
	]
});
```

If not, be sure to give your execution role the permission to perform `sqs:SendMessage` on the SQS Queue.

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
	"description": "Webhook Triggers Registration",
	"layers": []
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

Every time an event happens, you have to trigger it. For that you need to provide the `clientCode`, `entity` and `eventName` associated to the event.
Additionally, you **must** provide the `content` of the event hook. This content **must** be a string of approximately less than 240Kb. In case you provide an object instead if a string, it will be JSON encoded for you. This content will be the request body that will be sent to the subscribers.

The `WebhookTrigger.send` signature is the following (typings are included in the package for intellisense):

```ts
type SendMessageSuccess = {
    success: true;
    messageId: string;
};
type SendMessageError = {
    success: false;
    message: object;
    errorMessage: string;
};
type SendMessageSkipped = {
    success: true;
    skipped: true;
};

type SendOptions = {
    targetUserId?: string;
};

WebhookTrigger.send(clientCode: string, entity: string, eventName: string, content: string | object, options?: SendOptions): Promise<SendMessageSuccess | SendMessageError | SendMessageSkipped>
```

The optional `options.targetUserId` field allows directing the webhook delivery only to subscriptions created by a specific user. If omitted, the event is delivered to all matching subscriptions as usual.

Before queuing, the event is validated against the client's locally synced subscriptions (see [Subscription pre-filtering](#subscription-pre-filtering)). If the client has no active subscription for the event, it is **not** queued and the method resolves with `{ success: true, skipped: true }`.

This method only rejects when required env vars are missing, to make easier to detect this issues on early testing. Errors ocurring at network or queue levels will be reported as `SendMessageError` in the return value.

### :new: Batch event triggering

Starting in v2, it's possible to trigger multiple events at once. To do so, use the `WebhookTrigger.sendBatch` method, passing an array of events.

The `WebhookTrigger.sendBatch` signature is the following (typings are included in the package for intellisense):

```ts
type WebhookEvent = {
    clientCode: string;
    entity: string;
    eventName: string;
    content: string | {
        [x: string]: any;
    };
    targetUserId?: string;
};

type SendMessageBatchResult = {
    successCount: number;
    failedCount: number;
    skippedCount: number;
    outputs: (SendMessageSuccess | SendMessageError | SendMessageSkipped)[];
};

WebhookTrigger.sendBatch(events: WebhookEvent[]): Promise<SendMessageBatchResult>
```

The optional `targetUserId` field per event allows directing delivery only to subscriptions created by a specific user. Events without it behave exactly as before.

Each event is validated against its client's locally synced subscriptions (see [Subscription pre-filtering](#subscription-pre-filtering)). Events without an active subscription are **not** queued, reported in the new `skippedCount` and added to `outputs` as `{ success: true, skipped: true, message }`, without affecting `successCount`/`failedCount`.

This method only rejects when required env vars are missing or the events sent are not an array, to make easier to detect this issues on early testing. Errors ocurring at network, queue or individual event validation levels will be reported as a `failedCount` and the detail will be present as a `SendMessageError` in the `outputs` property.

### Subscription pre-filtering

`send()` and `sendBatch()` avoid queuing webhooks nobody is subscribed to. They validate each event against a **local copy** of the client's subscriptions, stored in the service's own `clients` collection under the `webhookSubscriptions` field (an array of `service:entity:eventName` keys).

- If `webhookSubscriptions` is an array (including `[]`) → the event is queued only if it includes `${JANIS_SERVICE_NAME}:${entity}:${eventName}`, otherwise it is skipped.
- If `webhookSubscriptions` is `undefined` (client never synced) or the read fails (client not found, client model missing, Mongo error) → **fail-open**: the event is queued anyway and the case is logged.

This means a service that updates the package but does **not** mount the consumer (below) never populates `webhookSubscriptions`, so it always fail-opens and behaves exactly as before. The pre-filtering only kicks in once the consumer is mounted (and the initial backfill has run).

The local copy is kept up to date by push: this package exposes an SQS consumer subscribed to the webhooks-service `clientSubscriptionsUpdated` topic. On every change it reconsolidates the client's subscriptions (invoking the `ClientTriggersSubscriptions` lambda, filtered by this service) and overwrites the local copy.

> **IMPORTANT**: The host service must expose its `client` model at `models/client` (resolved as `{process.cwd()}/{MS_PATH}/models/client`), pointing to the `core` `clients` collection. This is the standard Janis client model.

#### Mounting the subscriptions consumer

First, create the consumer handler file. Its path **must** match the handler generated by the hooks: `src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.js`.

```js
// In src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.js
'use strict';

const { SyncWebhookSubscriptionsConsumer } = require('@janiscommerce/webhook-trigger');
const { SQSHandler } = require('@janiscommerce/sqs-consumer');

module.exports.handler = event => SQSHandler.handle(SyncWebhookSubscriptionsConsumer, event);
```

Then add the serverless hooks. The `SQSHelper` from your own `sls-helper-plugin-janis` version is injected by parameter:

```js
const { helper } = require('sls-helper');
const { SQSHelper } = require('sls-helper-plugin-janis');
const { subscriptionsConsumerServerlessHelperHooks } = require('@janiscommerce/webhook-trigger');

module.exports = helper({
	hooks: [
		// ...your other hooks
		...subscriptionsConsumerServerlessHelperHooks(SQSHelper)
	]
});
```

This declares the queue subscribed to `webhooks/clientSubscriptionsUpdated` (filtered by your service), the `MainQueue → DelayQueue → DLQ` resilience chain and the IAM permissions needed to invoke the lambda.

The consumer, queue and delay properties can be overridden via a second argument:

```js
subscriptionsConsumerServerlessHelperHooks(SQSHelper, {
	consumerProperties: { prefixPath: 'webhook', batchSize: 1 },
	mainQueueProperties: { maxReceiveCount: 3 },
	delayQueueProperties: { delaySeconds: 300 }
});
```

> The CloudWatch alarm over the DLQ is managed by infra, out of the scope of this package.

## :computer: Examples

> Send an event when an order is created

```js
const WebhookTrigger = require('@janiscommerce/webhook-trigger');

await WebhookTrigger.send('currentClientCode', 'order', 'created', {
	id: 'd555345345345aa67a342a55',
	dateCreated: new Date(),
	amount: 10.40
});
```

> Send multiple events when multiple orders are dispatched (you could even send events for more than one `clientCode` and/or each with a different `eventName`)

```js
const WebhookTrigger = require('@janiscommerce/webhook-trigger');

await WebhookTrigger.send([
	{
		clientCode: 'currentClientCode',
		entity: 'order',
		eventName: 'dispatched',
		content: {
			id: 'd555345345345aa67a342a55',
			dateCreated: new Date(),
			amount: 10.40
		}
	},
	{
		clientCode: 'currentClientCode',
		entity: 'order',
		eventName: 'dispatched',
		content: {
			id: 'e55a3a53e5645aa67a34254a',
			dateCreated: new Date(),
			amount: 32.5
		}
	}
]);
```
