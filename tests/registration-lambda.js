'use strict';

const assert = require('assert');
const sinon = require('sinon');

const fs = require('fs');
const YAML = require('js-yaml');
const { RegistrationLambda, Registration } = require('../lib');

describe('Service Registration Lambda', () => {

	const triggersDefinitionFilePath = '/path/to/definition/file.yml';

	const serviceName = 'MY_SERVICE';
	const entity = 'order';
	const eventName = 'created';

	const triggers = [
		{
			entity,
			eventName
		},
		{
			entity,
			eventName: 'picked'
		}
	];

	const triggersYAML = YAML.dump(triggers);

	let env;
	const ensureEnvVar = value => {
		env = { ...process.env };
		process.env.JANIS_SERVICE_NAME = value;
	};

	beforeEach(() => {
		ensureEnvVar(serviceName);
		sinon.stub(fs, 'accessSync');
		sinon.stub(fs, 'readFileSync').returns(triggersYAML);
		sinon.stub(Registration, 'register').resolves();
	});

	afterEach(() => {
		process.env = { ...env };
		sinon.restore();
	});

	const lambdaHandler = RegistrationLambda(triggersDefinitionFilePath);

	// delete process.env.JANIS_SERVICE_NAME;
	it('Should resolve and do nothing if the definition file does not exist', async () => {

		const fileDoesNotExistError = new Error('File does not exist');
		fileDoesNotExistError.code = 'ENOENT';
		fs.accessSync.throws(fileDoesNotExistError);

		await assert.doesNotReject(() => lambdaHandler());

		sinon.assert.calledOnceWithExactly(fs.accessSync, triggersDefinitionFilePath, fs.constants.F_OK);
		sinon.assert.notCalled(fs.readFileSync);
		sinon.assert.notCalled(Registration.register);
	});

	it('Should reject if definition file exists but throws an error while checking', async () => {

		fs.accessSync.throws(new Error('FS internal error'));

		await assert.rejects(() => lambdaHandler(), {
			message: 'FS internal error'
		});

		sinon.assert.calledOnceWithExactly(fs.accessSync, triggersDefinitionFilePath, fs.constants.F_OK);
		sinon.assert.notCalled(fs.readFileSync);
		sinon.assert.notCalled(Registration.register);
	});

	it('Should reject if definition file exists but throws an error while checking', async () => {

		fs.readFileSync.throws(new Error('FS internal error'));

		await assert.rejects(() => lambdaHandler(), {
			message: 'FS internal error'
		});

		sinon.assert.calledOnceWithExactly(fs.accessSync, triggersDefinitionFilePath, fs.constants.F_OK);
		sinon.assert.calledOnceWithExactly(fs.readFileSync, triggersDefinitionFilePath, 'utf8');
		sinon.assert.notCalled(Registration.register);
	});

	it('Should reject if definition file is not a valid YAML', async () => {

		fs.readFileSync.returns('***?invalidyaml');

		await assert.rejects(() => lambdaHandler(), {
			name: 'YAMLException'
		});

		sinon.assert.calledOnceWithExactly(fs.accessSync, triggersDefinitionFilePath, fs.constants.F_OK);
		sinon.assert.calledOnceWithExactly(fs.readFileSync, triggersDefinitionFilePath, 'utf8');
		sinon.assert.notCalled(Registration.register);
	});

	it('Should reject if definition file exists but throws an error while checking', async () => {

		Registration.register.throws(new Error('Registration error'));

		await assert.rejects(() => lambdaHandler(), {
			message: 'Registration error'
		});

		sinon.assert.calledOnceWithExactly(fs.accessSync, triggersDefinitionFilePath, fs.constants.F_OK);
		sinon.assert.calledOnceWithExactly(fs.readFileSync, triggersDefinitionFilePath, 'utf8');
		sinon.assert.calledOnceWithExactly(Registration.register, triggers);
	});

	it('Should register the triggers and resolve if no errors occur', async () => {

		await assert.doesNotReject(() => lambdaHandler());

		sinon.assert.calledOnceWithExactly(fs.accessSync, triggersDefinitionFilePath, fs.constants.F_OK);
		sinon.assert.calledOnceWithExactly(fs.readFileSync, triggersDefinitionFilePath, 'utf8');
		sinon.assert.calledOnceWithExactly(Registration.register, triggers);
	});

});
