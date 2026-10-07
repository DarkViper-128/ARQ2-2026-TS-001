# Especificación de la API y contratos

> Formato OpenSpec: cada capacidad se describe con requisitos (`DEBE`) y escenarios `CUANDO`/`ENTONCES`.

## Propósito

<!-- Describe en 2-3 líneas qué hace el sistema y a quién sirve. -->

## Requisitos

### Requisito: <Nombre de la capacidad>

El sistema DEBE <comportamiento esperado>.

#### Escenario: <Caso exitoso>

- **CUANDO** <acción o petición, p. ej. `POST /recurso` con un cuerpo válido>
- **ENTONCES** <resultado esperado, p. ej. responde `201 Created` con el recurso creado>

#### Escenario: <Caso de error>

- **CUANDO** <petición inválida>
- **ENTONCES** <respuesta de error, p. ej. `400 Bad Request`>

## Contratos

### `<MÉTODO> /ruta`

**Petición**

```json
{}
```

**Respuesta `200`**

```json
{}
```
