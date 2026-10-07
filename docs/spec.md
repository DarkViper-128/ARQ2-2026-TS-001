# API Specification and Contracts

> OpenSpec format: each capability is described with requirements (`SHALL`/`MUST`) and `WHEN`/`THEN` scenarios.

## Purpose

<!-- Describe in 2-3 lines what the system does and who it serves. -->

## Requirements

### Requirement: <Capability name>

The system SHALL <expected behavior>.

#### Scenario: <Success case>

- **WHEN** <action or request, e.g. `POST /resource` with a valid body>
- **THEN** <expected result, e.g. responds `201 Created` with the created resource>

#### Scenario: <Error case>

- **WHEN** <invalid request>
- **THEN** <error response, e.g. `400 Bad Request`>

## Contracts

### `<METHOD> /path`

**Request**

```json
{}
```

**Response `200`**

```json
{}
```
