'use strict';

const { inspect } = require('util');

module.exports = class EventValidator {

	static throwError(fieldName, validTypes, actualValue) {
		throw new TypeError(`Invalid ${fieldName}. Expected ${validTypes} but received ${inspect(actualValue)}`);
	}

	static validate(clientCode, entity, eventName, content) {

		if(!process.env.JANIS_SERVICE_NAME || !process.env.JANIS_SERVICE_NAME.trim())
			this.throwError('env var JANIS_SERVICE_NAME', 'string', process.env.JANIS_SERVICE_NAME);

		if(typeof clientCode !== 'string' || !clientCode.trim())
			this.throwError('clientCode', 'string', clientCode);

		if(typeof entity !== 'string' || !entity.trim())
			this.throwError('entity', 'string', entity);

		if(typeof eventName !== 'string' || !eventName.trim())
			this.throwError('eventName', 'string', eventName);

		if(!content || (typeof content === 'string' && !content.trim()) || (typeof content !== 'string' && typeof content !== 'object'))
			this.throwError('content', 'string | object', content);
	}
};
