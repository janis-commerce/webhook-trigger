'use strict';

const path = require('path');

/**
 * The client subscriptions read cache TTL, in milliseconds.
 * `send()` is called at very high frequency (specially for stock webhooks), so the
 * subscriptions of a client are cached to avoid hitting Mongo on every event.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {object} ClientDocument
 * @property {string} code The Janis Client code
 * @property {string[]} [webhookSubscriptions] The client's synced webhook subscription keys (`service:entity:eventName`)
 */

/**
 * Unified access to the service host `client` model (`databaseKey: 'core'`, table `clients`).
 *
 * The model class is resolved dynamically from the host service (`{cwd}/{MS_PATH}/models/client`)
 * and memoized. It is instantiated **without session**: the `core` database is resolved before the
 * session check, so `new ClientModel()` is valid both for reading and writing.
 *
 * Reads are cached in-memory per clientCode for 5 minutes; writes are never cached.
 */
module.exports = class ClientModel {

	/**
	 * Resolves and memoizes the host service `client` model instance.
	 *
	 * @returns {object} The client model instance
	 * @throws If the host service does not expose a client model at the expected path
	 */
	static getModel() {

		if(this._modelInstance)
			return this._modelInstance;

		const modelPath = path.join(process.cwd(), process.env.MS_PATH || '', 'models', 'client');

		try {
			// eslint-disable-next-line global-require, import/no-dynamic-require
			const Model = require(modelPath);
			/** @private */
			this._modelInstance = new Model();
			return this._modelInstance;
		} catch(error) {
			throw new Error(`Unable to load client model from '${modelPath}': ${error.message}`);
		}
	}

	/**
	 * @private
	 */
	static get cache() {

		if(!this._cache)
			/** @private */
			this._cache = {};

		return this._cache;
	}

	/**
	 * Reads a client's synced webhook subscriptions, cached for 5 minutes per clientCode.
	 *
	 * @param {string} clientCode The Janis Client code
	 * @returns {Promise<string[]|undefined>} The subscription keys, or `undefined` if the client was never synced
	 * @throws If the model cannot be resolved, the client is not found or the read fails
	 */
	static async getSubscriptions(clientCode) {

		const cachedClient = this.getClientFromCache(clientCode);

		if(cachedClient)
			return cachedClient.webhookSubscriptions;

		const model = this.getModel();

		const [client] = await model.getBy('code', clientCode, { limit: 1 });

		if(!client)
			throw new Error(`Client not found for code '${clientCode}'`);

		this.updateClientCache(clientCode, client);

		return client.webhookSubscriptions;
	}

	/**
	 * Overwrites a client's webhook subscriptions. Not cached.
	 *
	 * @param {string} clientCode The Janis Client code
	 * @param {string[]} webhookSubscriptions The consolidated subscription keys to persist
	 * @returns {Promise} The model update result
	 */
	static async updateSubscriptions(clientCode, webhookSubscriptions) {

		const model = this.getModel();

		return model.update({ webhookSubscriptions }, { code: clientCode }, { skipAutomaticSetModifiedData: true });
	}

	/**
	 * @private
	 * @param {string} clientCode
	 * @returns {ClientDocument|undefined}
	 */
	static getClientFromCache(clientCode) {

		const cached = this.cache[clientCode];

		if(!cached || Date.now() >= cached.expirationTime)
			return;

		return cached.client;
	}

	/**
	 * @private
	 * @param {string} clientCode
	 * @param {ClientDocument} client
	 */
	static updateClientCache(clientCode, client) {

		this.cache[clientCode] = {
			expirationTime: Date.now() + CACHE_TTL_MS,
			client
		};
	}

	/**
	 * Clears the in-memory subscriptions cache and the memoized model instance.
	 * Intended for tests.
	 */
	static clearCache() {
		/** @private */
		this._cache = null;
		/** @private */
		this._modelInstance = null;
	}
};
