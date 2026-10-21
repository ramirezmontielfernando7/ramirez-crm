# Parches de seguridad de dependencias

Registro de lo que `pnpm audit` encontró y qué se hizo. Las subidas se limitan
a la misma versión mayor (sin saltos riesgosos) y no hay migraciones.

## Octubre 2026

### Actualizado (producción)

| Paquete | Antes | Ahora | Problema (gravedad) |
|---|---|---|---|
| `next` | 15.5.26 | 15.5.28 | Envenenamiento de caché en páginas SSG/ISR autoalojadas (2 avisos, moderada) |
| `sharp` (lo trae `next`) | 0.35.4 | 0.35.5 | Falla en librsvg al procesar imágenes (alta) |
| `source-map-js` (vía `next`/`postcss`) | 1.2.1 | 1.2.2 | Denegación de servicio con mapas de código manipulados (alta) |

`eslint-config-next` y `@next/eslint-plugin-next` suben junto con `next`.
`sharp` y `source-map-js` se fijan con `overrides` en `pnpm-workspace.yaml`
(quitar cuando `next` ya los resuelva solo).

### Actualizado (solo desarrollo)

- `postcss-selector-parser` 6.1.4 → 7.1.6 (vía `tailwindcss`; moderada,
  consumo de CPU). Solo se usa al compilar estilos.

### Pendiente

| Paquete | Gravedad | Motivo por el que no se tocó |
|---|---|---|
| `vitest` 2.1.9 (y `vite`, `esbuild`, `tinypool`, `@vitest/mocker` que trae) | crítica / alta / moderada | Solo desarrollo y CI: afecta al servidor de interfaz/desarrollo de Vitest, que aquí no se usa ni se expone. El parche exige `vitest >= 3.2.6` (y `vite` 6): un salto mayor del ejecutor de pruebas. Hacerlo en un PR aparte. |
| `braces` 3.0.3 (vía `eslint-config-next`) | alta, solo desarrollo | El registro aún no publica la 3.0.4 que lo corrige. Revisar de nuevo más adelante. |

Nada de lo pendiente llega a la imagen de producción.
