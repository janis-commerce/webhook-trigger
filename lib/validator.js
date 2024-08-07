'use strict';

const { inspect } = require('node:util');

module.exports = class Validator {

	static throwError(fieldName, validTypes, actualValue) {
		throw new TypeError(`Invalid ${fieldName}. Expected ${validTypes} but received ${inspect(actualValue)}`);
	}

	static validateEvent(clientCode, entity, eventName, content) {

		if(typeof clientCode !== 'string' || !clientCode.trim())
			this.throwError('clientCode', 'string', clientCode);

		if(typeof entity !== 'string' || !entity.trim())
			this.throwError('entity', 'string', entity);

		if(typeof eventName !== 'string' || !eventName.trim())
			this.throwError('eventName', 'string', eventName);

		if(!content || (typeof content === 'string' && !content.trim()) || (typeof content !== 'string' && typeof content !== 'object'))
			this.throwError('content', 'string | object', content);
	}

	static validateTriggers(triggers) {

		if(!process.env.JANIS_SERVICE_NAME || !process.env.JANIS_SERVICE_NAME.trim())
			this.throwError('env var JANIS_SERVICE_NAME', 'string', process.env.JANIS_SERVICE_NAME);

		if(!Array.isArray(triggers))
			this.throwError('triggers', 'array', triggers);

		triggers.forEach((trigger, index) => {

			if(!trigger || typeof trigger !== 'object' || Array.isArray(trigger))
				this.throwError(`triggers.${index}`, 'object', trigger);

			const { entity, eventName } = trigger;

			if(typeof entity !== 'string' || !entity.trim())
				this.throwError(`triggers.${index}.entity`, 'string', entity);

			if(typeof eventName !== 'string' || !eventName.trim())
				this.throwError(`triggers.${index}.eventName`, 'string', eventName);

		});

	}
};
