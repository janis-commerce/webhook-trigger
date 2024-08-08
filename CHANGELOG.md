# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2024-08-08
### Changed
- **BREAKING CHANGE** Migrated Registration and Event emitting from APIs to Lambda and direct SQS integration. See [Migration guide](/migration-guides/v1-to-v2.md)
- **BREAKING CHANGE** Dropped support for node 14 and 16.

## [1.0.0] - 2023-06-07
### Changed
- Update package [@janiscommerce/microservice-call](https://www.npmjs.com/package/@janiscommerce/microservice-call) that use AWS SDK V3

## [0.2.1] - 2021-06-24
### Fixed
- Added ApiSession to include janis-client in call to Webhook API

## [0.2.0] - 2021-03-11
### Added
- Registration
- RegistrationLambda
- Registration process docs

## [0.1.0] - 2021-03-08
### Added
- WebhookTrigger
- Package documentation
- Package types
