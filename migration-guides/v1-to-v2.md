# Migration guide from v1 to v2

The following are the breaking changes from v1 to v2

## Node 14 is no longer supported

Minimum support has been moved to node 18

## Environment variable `JANIS_WEBHOOKS_QUEUE_URL` must now be defined

This has to be defined as the URL of the Queue of the Webhook Service. It should look something like this: `https://sqs.region.amazonaws.com/accountId/WebhookEvents`

## `Webhook.send()` returns a different type

Previously, this method returned a raw object with `statusCode` and `body` from the Webhooks service. It also could reject if the upstream service failed.

Now, this method only fails for client-side related issues (missing env vars, invalid event data). Upstream errors are now handled and resolved properly.

When sending an event, you should handle rejections for client-side issues, and check the response (`success` boolean property) to check whether the message was sent or not.

> As a side note, this package now uses `@aws-sdk/client-sqs` instead of `@janiscommerce/microservice-call`, so you need to have appropiate permissions set.
