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

### Serverless hooks

If you run your service in AWS Lambda with Serverless Helper, import and spread `serverlessHelperHooks` in your `serverless.js`. This **single** spread sets up everything the package needs:

- The IAM permission and env var to send messages to the Webhooks SQS Queue.
- The mandatory subscriptions consumer (queue, `MainQueue → DelayQueue → DLQ` resilience chain and the IAM to invoke the reconsolidation lambda) that keeps the local subscriptions copy synced (see [Subscription pre-filtering](#subscription-pre-filtering)).

You **must** inject your own `SQSHelper` from `sls-helper-plugin-janis` (the package does not depend on it) and create the consumer handler file (see below).

```js
const { helper } = require('sls-helper');
const { SQSHelper } = require('sls-helper-plugin-janis');
const { serverlessHelperHooks } = require('@janiscommerce/webhook-trigger');

module.exports = helper({
	hooks: [
		...serverlessHelperHooks(SQSHelper)
	]
});
```

> `serverlessHelperHooks` throws at `sls package`/`deploy` time if the `SQSHelper` is not injected or if the consumer handler file is missing, so misconfigurations fail fast instead of shipping a consumer that never syncs.

If you don't use Serverless Helper, be sure to give your execution role the permission to perform `sqs:SendMessage` on the SQS Queue and to mount the subscriptions consumer yourself.

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

Once you have everything validated, you **should** include this invocation in your CI/CD pipeline:

```sh
aws lambda invoke --function-name <ServiceName>-<stage>-WebhookTriggersRegistration output --log-type Tail --query 'LogResult' --output text | base64 -d
```

> If you want to register your triggers in a different way, the `Registration` class is also exported by this package.

### Event triggering

Every time an event happens, you have to trigger it. For that you need to provide the `clientCode`, `entity` and `eventName` associated to the event.
Additionally, you **must** provide the `content` of the event hook. This content **must** be a string of approximately less than 240Kb. In case you provide an object instead of a string, it will be JSON encoded for you. This content will be the request body that will be sent to the subscribers.

The `WebhookTrigger.send` signature is the following (typings are included in the package for intellisense):

```ts
type SendMessageSuccess = {
    success: true;
    messageId: string;
    correlationId?: string; // Only present in sendBatch outputs, and only when the event provided it
};
type SendMessageError = {
    success: false;
    message: object;
    errorMessage: string;
    correlationId?: string; // Only present in sendBatch outputs, and only when the event provided it
};
type SendMessageSkipped = {
    success: true;
    skipped: true;
    message?: object; // Only present in sendBatch outputs
    correlationId?: string; // Only present in sendBatch outputs, and only when the event provided it
};

type SendOptions = {
    targetUserId?: string;
};

WebhookTrigger.send(clientCode: string, entity: string, eventName: string, content: string | object, options?: SendOptions): Promise<SendMessageSuccess | SendMessageError | SendMessageSkipped>
```

The optional `options.targetUserId` field allows directing the webhook delivery only to subscriptions created by a specific user. If omitted, the event is delivered to all matching subscriptions as usual.

Before queuing, the event is validated against the client's locally synced subscriptions (see [Subscription pre-filtering](#subscription-pre-filtering)). If the client has no active subscription for the event, it is **not** queued and the method resolves with `{ success: true, skipped: true }`.

This method only rejects when required env vars are missing, to make it easier to detect these issues early on. Errors occurring at network or queue levels will be reported as `SendMessageError` in the return value.

### Batch event triggering

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
    correlationId?: string;
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

This method only rejects when required env vars are missing or the events sent are not an array, to make it easier to detect these issues early on. Errors occurring at network, queue or individual event validation levels will be reported as a `failedCount` and the detail will be present as a `SendMessageError` in the `outputs` property.

> **Added in v3.1.0**: the optional `correlationId` field per event. If provided, it's echoed back in the corresponding `output` (in all 4 possible outcomes: success, send failure, skipped, validation failure), letting the caller correlate each output 1:1 with its originating event — regardless of order or content collisions. It's **metadata only**: it's never sent to the webhook subscriber and it's never used as the underlying SQS batch entry `Id` (which stays the event's positional index, since a `correlationId` could contain invalid characters for it or be repeated across events). Events without it behave exactly as before (the field is simply absent from the output).
>
> ```js
> const result = await WebhookTrigger.sendBatch([
>     { clientCode: 'currentClientCode', entity: 'order', eventName: 'dispatched', content: { id: 'order-1' }, correlationId: 'record-1' },
>     { clientCode: 'currentClientCode', entity: 'order', eventName: 'dispatched', content: { id: 'order-2' }, correlationId: 'record-2' }
> ]);
>
> // result.outputs:
> // [
> //     { success: true, messageId: 'aaaa-...', correlationId: 'record-1' },
> //     { success: false, message: { ... }, errorMessage: 'SDK Error', correlationId: 'record-2' }
> // ]
> ```

### Subscription pre-filtering

`send()` and `sendBatch()` avoid queuing webhooks nobody is subscribed to. They validate each event against a **local copy** of the client's subscriptions, stored in the service's own `clients` collection under the `webhookSubscriptions` field (an array of `service:entity:eventName` keys). On read, it's converted to a `Set` (kept in memory only) for O(1) lookup and cached per `clientCode` for 5 minutes, since this check runs at very high frequency (specially for stock webhooks).

- If `webhookSubscriptions` is synced (including an empty array) → the event is queued only if the set includes `${JANIS_SERVICE_NAME}:${entity}:${eventName}`, otherwise it is skipped.
- If `webhookSubscriptions` is `undefined` (client never synced) or the read fails (client not found, client model missing, Mongo error) → **fail-open**: the event is queued anyway. The former case is logged as a `warn`, the latter as an `error`.

This means a service that updates the package but does **not** mount the consumer (below) never populates `webhookSubscriptions`, so it always fail-opens and behaves exactly as before. The pre-filtering only kicks in once the consumer is mounted (and the initial backfill has run).

The local copy is kept up to date by push: this package exposes an SQS consumer subscribed to the webhooks-service `clientSubscriptionsUpdated` topic. On every change it reconsolidates the client's subscriptions (invoking the `ClientTriggersSubscriptions` lambda, filtered by this service) and overwrites the local copy.

> **IMPORTANT**: The host service must expose its `client` model at `models/client` (resolved as `{process.cwd()}/{MS_PATH}/models/client`), pointing to the `core` `clients` collection. This is the standard Janis client model.

#### `WebhookTrigger.shouldSend()`

> **Added in v3.1.0**

`send()`/`sendBatch()` already apply this pre-filtering internally, so in most cases you don't need to call this method yourself. It's exposed for cases where building the event `content` is expensive (eg. extra queries, formatting) and you want to short-circuit **before** doing that work, instead of paying the cost only to have the event skipped afterwards.

```ts
WebhookTrigger.shouldSend(clientCode: string, entity: string, eventName: string): Promise<boolean>
```

It runs the exact same check described above (same `Set`, same cache, same **fail-open** semantics: resolves `true` when the client has no synced subscriptions or the read fails). It never queues anything by itself.

```js
const { WebhookTrigger } = require('@janiscommerce/webhook-trigger');

if(await WebhookTrigger.shouldSend('currentClientCode', 'order', 'created')) {
    const content = await buildExpensiveOrderPayload(order); // only computed if there's an active subscription
    await WebhookTrigger.send('currentClientCode', 'order', 'created', content);
}
```

#### Mounting the subscriptions consumer

The consumer serverless hooks (queue subscribed to `webhooks/clientSubscriptionsUpdated`, the `MainQueue → DelayQueue → DLQ` resilience chain and the IAM permissions needed to invoke the lambda) are already declared by the single `serverlessHelperHooks(SQSHelper)` spread (see [Serverless hooks](#serverless-hooks)).

You only need to create the consumer handler file. Its path **must** match the handler generated by the hooks: `src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.js`.

```js
// In src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.js
'use strict';

const { SyncWebhookSubscriptionsConsumer } = require('@janiscommerce/webhook-trigger');
const { SQSHandler } = require('@janiscommerce/sqs-consumer');

module.exports.handler = event => SQSHandler.handle(SyncWebhookSubscriptionsConsumer, event);
```

The consumer, queue and delay properties can be overridden via a second argument to `serverlessHelperHooks`:

```js
serverlessHelperHooks(SQSHelper, {
	consumerProperties: { prefixPath: 'webhook', batchSize: 1 },
	mainQueueProperties: { maxReceiveCount: 3 },
	delayQueueProperties: { delaySeconds: 300 }
});
```

> If you override `consumerProperties.prefixPath`, the handler file path changes accordingly (`src/sqs-consumer/<prefixPath>/sync-webhook-subscriptions-consumer.js`).

> The CloudWatch alarm over the DLQ is managed by infra, out of the scope of this package.

## :computer: Examples

> Send an event when an order is created

```js
const { WebhookTrigger } = require('@janiscommerce/webhook-trigger');

await WebhookTrigger.send('currentClientCode', 'order', 'created', {
	id: 'd555345345345aa67a342a55',
	dateCreated: new Date(),
	amount: 10.40
});
```

> Send multiple events when multiple orders are dispatched (you could even send events for more than one `clientCode` and/or each with a different `eventName`)

```js
const { WebhookTrigger } = require('@janiscommerce/webhook-trigger');

await WebhookTrigger.sendBatch([
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
