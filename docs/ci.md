# CI: qué corre, qué no y por qué

Dos workflows en `.github/workflows/`:

- **CI** (`ci.yml`): `gates` (typecheck, lint, test, build; en dos
  configuraciones), `db` (migraciones dos veces + aislamiento con Postgres
  real) y `e2e-multiorg` (solo en PRs a `main`: build + varios guiones E2E
  contra la app compilada con mocks).
- **Imagen** (`imagen.yml`): construye la imagen Docker en cada PR y la
  publica solo con un tag `vX.Y.Z`.

Cada job tiene `timeout-minutes` para que un cuelgue no espere 6 horas.

## Guiones E2E que NO corren en CI

Se pueden correr a mano con `pnpm test:e2e:<nombre>` (app levantada, `.env`
con `WA_MOCK_ENABLED=true`). No se agregaron a CI a ciegas: cada uno suma
minutos al job más lento y varios nunca se han probado contra `next start`
con `ALLOW_CI_MOCKS`. Agregarlos de uno en uno, comprobando que pasen
estables en CI.

alta-manual, anuncio-origen-ui, bandeja-campanas, bandeja-colores,
bitacora-etapas, calendario, campanas (v1), chat-equipo, compositor,
conocimientos, envio-instantaneo, favicon, ficha-lead, firma-webhook,
linea-tiempo, messenger, monto-pipeline, panel-perdido,
participantes-menciones, prioridad, redaccion, responsive, resultados,
roles, search-filters, selftest, send-failure, templates-multivar,
templates-sync.

Candidatos razonables para el siguiente paso: `responsive` (cubre teléfono y
tableta, hoy nadie lo vigila) y `bandeja-campanas`.

## E2E inestables en contenedor

Algunos guiones fallan en el contenedor de Claude Code (sin GPU, CPU
compartida, sin Postgres de servicio) y pasan en GitHub Actions. Lo que manda
es CI: si un guion falla solo en el contenedor, no es motivo para tocar la
prueba; anótalo en el PR como «no probado localmente».

## Lo que NO conviene tocar sin plan

- Partir `e2e-multiorg` en jobs paralelos: ahorraría tiempo pero cada job
  repite install + build (~minutos) y el segundo paso depende de la
  organización que crea el primero.
- Quitar la matriz `default`/`completo` de `gates`: duplica tiempo pero es lo
  que prueba las banderas apagadas y encendidas.
- Cachear el build de Next entre jobs: posible, pero un caché viejo puede
  esconder errores de build.
