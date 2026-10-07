# Especificación de la API y contratos

> Formato OpenSpec: cada capacidad se describe con requisitos (`SHALL`/`MUST`) y escenarios `WHEN`/`THEN`.

## Purpose

<!-- Describe en 2-3 líneas qué hace el sistema y a quién sirve. -->

## Requirements

### Requirement: <Nombre de la capacidad>

El sistema SHALL <comportamiento esperado>.

#### Scenario: <Caso exitoso>

- **WHEN** <acción o petición, p. ej. `POST /recurso` con un cuerpo válido>
- **THEN** <resultado esperado, p. ej. responde `201 Created` con el recurso creado>

#### Scenario: <Caso de error>

- **WHEN** <petición inválida>
- **THEN** <respuesta de error, p. ej. `400 Bad Request`>

## Contracts

### `<MÉTODO> /ruta`

**Request**

```json
{}
```

**Response `200`**

```json
{}
```
