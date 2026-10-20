# 043 — Operación 1: respaldos y apagado limpio

**Carril**: ligero. **Sin migraciones.** Dos PRs: primero respaldos (guiones y
guía), después apagado limpio. Pedido, diagnóstico (Fase 1) y respuestas del
dueño aprobados el 2026-10-20, antes de programar.

Contexto: Dashfort corre en Coolify (un contenedor de la app + su
PostgreSQL 18 como recurso propio de Coolify, contenedor
`x1rilm10dmhsci06wg6nmia6`); las migraciones corren al arrancar el
contenedor; vienen campañas masivas de WhatsApp.

## PR 1 — Respaldos y recuperación

### Comportamiento observable

1. `node ops/respaldo.mjs` (en la imagen; fuente `scripts/respaldo.mjs`) saca
   un `pg_dump` en formato propio a `/data/backups/dashfort-<base>-<fecha>.dump`
   y un `.tar.gz` de `MEDIA_DIR`, cada uno con su `.sha256`, permisos 600.
   `--sin-media`, `--solo-media` (la tarea programada de Coolify),
   `--guardar N` (por tipo: base y solo-archivos se cuentan aparte),
   `--dir`.
2. Se niega antes de empezar si `pg_dump` es de una versión MENOR que el
   servidor, o si no hay en el volumen al menos el tamaño de la base libre.
   Con un rol sujeto a RLS, `pg_dump` falla (apaga `row_security`): nunca un
   respaldo vacío que parezca bueno. Escribe `*.partial` y solo renombra
   cuando `pg_restore --list` lo leyó.
3. `node ops/probar-restauracion.mjs` restaura el respaldo más nuevo (o
   `--archivo`, también los `.dmp` de Coolify) en una base TEMPORAL
   `vocero_prueba_restauracion_<fecha>` con `--no-owner --no-acl`, revisa
   organizaciones, migraciones (frente a `drizzle/` de la imagen), conteos
   (con los de producción al lado) y que la `ENCRYPTION_KEY` del contenedor
   abra los secretos de la copia (AES-GCM verifica; lo descifrado se
   descarta). Borra la base temporal siempre. Sale 0 solo si todo pasa.
4. Candado (`assertBaseDePrueba`): el nombre lo genera el guion, con
   prefijo fijo, identificador simple y distinto de la base de producción;
   se comprueba antes de crear, restaurar y borrar. Un `.sql` de texto se
   rechaza (podría `\connect` a otra base).
5. Guía [docs/respaldos.md](../../docs/respaldos.md) para quien no programa:
   respaldos programados de Coolify v4 (14 locales), tarea programada para
   `/data/media`, guardar la `ENCRYPTION_KEY` aparte, bajar copias a la
   computadora, prueba mensual con registro, R2/B2 opcional, y restauración
   de emergencia (servidor vivo / servidor perdido), incluida la pausa de
   campañas tras restaurar (si no, se reenviaría a quien ya recibió).

### Decisiones

- `postgresql18-client` en la imagen (Alpine 3.24, base de `node:22-alpine`,
  lo trae: `main/postgresql18`, 18.6). `PG_BIN=/usr/libexec/postgresql18`
  fijo en el Dockerfile. Si la base cambia y el paquete no existe, el build
  falla.
- Sin S3 por ahora: la guía cubre primero «descargar a tu computadora».
- CI (`imagen.yml`, job `respaldos`): construye la imagen, comprueba que
  `pg_dump` sea 18, migra un Postgres 18 real, respalda, verifica sumas y
  el `.tar.gz`, prueba la restauración (APROBADA), que la base temporal no
  quede, y que con otra llave la prueba FALLE.

## PR 2 — Apagado limpio

Va en un PR aparte, con su propio documento en esta carpeta (`apagado.md`).

## Pendientes

- **Retoma duradera de los turnos del agente al arrancar.** Hoy un turno que
  esperaba su ventana de 6 s o corría en el instante del corte se pierde y
  nada lo retoma. El PR 2 solo los deja terminar dentro del tiempo de gracia;
  retomarlos al arrancar exige tocar `src/server/ai/pipeline.ts`, que otra
  sesión está cambiando. Va en un PR aparte.
