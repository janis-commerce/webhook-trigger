# Migration guide from v2 to v3

The following are the breaking changes from v2 to v3

## `serverlessHelperHooks` now requires the `SQSHelper` and mounts the subscriptions consumer

In v2 `serverlessHelperHooks()` only added the emitter permissions (env var + IAM to send messages to the Webhooks queue), and the subscriptions consumer had to be mounted separately.

In v3, `serverlessHelperHooks` is the **single** mount point. It now receives the `SQSHelper` from your own `sls-helper-plugin-janis` version and returns the emitter hooks **plus** the mandatory subscriptions consumer hooks (queue subscribed to `webhooks/clientSubscriptionsUpdated`, the `MainQueue → DelayQueue → DLQ` resilience chain and the IAM to invoke the reconsolidation lambda).

```diff
const { helper } = require('sls-helper');
+const { SQSHelper } = require('sls-helper-plugin-janis');
const { serverlessHelperHooks } = require('@janiscommerce/webhook-trigger');

module.exports = helper({
	hooks: [
-		...serverlessHelperHooks()
+		...serverlessHelperHooks(SQSHelper)
	]
});
```

The consumer is now mandatory (not opt-in) because it's what keeps the local `webhookSubscriptions` copy synced and enables the send-time pre-filter. A service that only spread the emitter hooks (v2 style) would never sync and would silently fail-open forever, so `serverlessHelperHooks` **throws at `sls package`/`deploy` time** if the `SQSHelper` is not injected.

## You must create the consumer handler file

Since the consumer is always mounted, its handler file must exist in the host service. `serverlessHelperHooks` **throws at `sls package`/`deploy` time** if it's missing, pointing to the expected path.

Create it at `src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.js` (or, if you override `consumerProperties.prefixPath`, at `src/sqs-consumer/<prefixPath>/sync-webhook-subscriptions-consumer.js`):

```js
// In src/sqs-consumer/webhook/sync-webhook-subscriptions-consumer.js
'use strict';

const { SyncWebhookSubscriptionsConsumer } = require('@janiscommerce/webhook-trigger');
const { SQSHandler } = require('@janiscommerce/sqs-consumer');

module.exports.handler = event => SQSHandler.handle(SyncWebhookSubscriptionsConsumer, event);
```

## The `subscriptionsConsumerServerlessHelperHooks` export was removed

It's no longer a public export. Its hooks are now included by `serverlessHelperHooks(SQSHelper)`. Remove any separate spread:

```diff
const { helper } = require('sls-helper');
const { SQSHelper } = require('sls-helper-plugin-janis');
-const { serverlessHelperHooks, subscriptionsConsumerServerlessHelperHooks } = require('@janiscommerce/webhook-trigger');
+const { serverlessHelperHooks } = require('@janiscommerce/webhook-trigger');

module.exports = helper({
	hooks: [
-		...serverlessHelperHooks(),
-		...subscriptionsConsumerServerlessHelperHooks(SQSHelper)
+		...serverlessHelperHooks(SQSHelper)
	]
});
```

## The pre-filter requires running the backfill

The send-time pre-filter validates each event against the local `clients.webhookSubscriptions` copy. That copy is populated by the consumer, but existing clients only get an update when their subscriptions next change. To populate it in bulk from day one you **must** run the webhooks-service backfill (`PublishClientsSubscriptions`), which publishes the `clientSubscriptionsUpdated` topic per client.

Until a client is synced, its `webhookSubscriptions` is `undefined` and the pre-filter **fails open** (the event is queued anyway and the case is logged), so behaviour stays backward-compatible. The pre-filter only starts skipping events once the client has been synced.
