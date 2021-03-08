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

This package exports a single entry point with a single method:

```js
const WebhookTrigger = require('@janiscommerce/webhook-trigger');

await WebhookTrigger.send(clientCode, entity, eventName, content);
```

The `WebhookTrigger.send` signature is the following:

```js
interface WebhookResponse {
	statusCode: number;
	body: object;
}

WebhookTrigger.send(clientCode: string, entity: string, eventName: string, content: string | object): Promise<WebhookResponse>;
```

If the `content` is not a string it will be JSON-encoded

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
