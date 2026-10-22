# ============================================================
# Vocero CRM — imagen multi-etapa (Next.js standalone + Node 22)
# Los secretos NO se necesitan en build: llegan en runtime.
# ============================================================

# pnpm se descarga UNA vez, aquí, con reintentos, y deps y builder lo comparten
# (capa cacheada). Antes cada etapa lo bajaba de registry.npmjs.org al primer
# `pnpm`, y un 503 de npm tumbaba el despliegue entero. Debe coincidir con
# `packageManager` de package.json (la etapa deps lo comprueba).
FROM node:22-alpine AS base
ARG PNPM_VERSION=11.5.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
 && for i in 1 2 3 4 5 6; do \
      corepack prepare "pnpm@${PNPM_VERSION}" --activate && break; \
      [ "$i" = 6 ] && exit 1; \
      echo "corepack: intento $i falló, reintento en $((i * 10)) s"; sleep $((i * 10)); \
    done

FROM base AS deps
ARG PNPM_VERSION=11.5.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN grep -q "\"packageManager\": \"pnpm@${PNPM_VERSION}\"" package.json \
 || { echo "PNPM_VERSION del Dockerfile no coincide con packageManager de package.json"; exit 1; }
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Commit del que sale la imagen, para que la app pueda decir qué está corriendo.
# Tiene que llegar como build arg en CADA despliegue; con docker compose,
# `--build-arg SOURCE_COMMIT=$(git rev-parse HEAD)`. Si falta nunca es un error
# de build: la app enseña solo la versión, o el SOURCE_COMMIT que encuentre en
# el entorno al arrancar, marcado como no verificado.
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN pnpm build
# migrate.mjs autocontenido (drizzle-orm + postgres bundleados)
RUN pnpm exec esbuild scripts/migrate.mjs --bundle --platform=node \
    --format=esm --outfile=migrate.bundle.mjs \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
# Fase 3: scripts de OPERADOR autocontenidos, para correrlos dentro del
# contenedor (docker exec … node ops/<script>.mjs). Usan DATABASE_URL_SYSTEM.
RUN for s in platform-admin purge-organization ai-quota bot-key set-consent-inicial kb-limits reclasificar-campanas respaldo probar-restauracion; do \
      pnpm exec esbuild scripts/$s.mjs --bundle --platform=node --format=esm --outfile=ops/$s.mjs \
        --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" || exit 1; \
    done
RUN pnpm exec esbuild scripts/seed/demo.ts --bundle --platform=node \
    --format=esm --outfile=seed-demo.bundle.mjs --alias:@=./src \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 008: adjuntos, logo e icono viven en /data (el volumen de la instancia), no
# en /app, que es de root: el default de la app (./.dev-media) es solo para
# desarrollo local. No se define en la plataforma: basta montar /data.
ENV MEDIA_DIR=/data/media
# su-exec: el entrypoint arranca como root SOLO para dejar /data escribible y
# baja a `vocero` antes de correr la app (idea de #40).
RUN apk add --no-cache su-exec
# Operación 1: pg_dump/pg_restore para ops/respaldo.mjs y
# ops/probar-restauracion.mjs (docs/respaldos.md). DEBE ser de la MISMA versión
# mayor que el Postgres de producción (18) o más nueva: un pg_dump más viejo
# no respalda un servidor más nuevo. node:22-alpine es Alpine 3.24, que trae
# postgresql18-client; si la base cambia y el paquete no existe, el build
# falla aquí (mejor que un respaldo que no se puede sacar). El job «Imagen» de
# CI comprueba que `$PG_BIN/pg_dump --version` diga 18.
RUN apk add --no-cache postgresql18-client
# Ruta fija a los binarios de la versión 18 (Alpine los instala aquí y solo
# enlaza a /usr/bin la versión «por defecto»): los guiones usan PG_BIN.
ENV PG_BIN=/usr/libexec/postgresql18
RUN addgroup -S vocero && adduser -S vocero -G vocero
# El punto de montaje nace de `vocero`: un volumen nombrado nuevo hereda ese
# dueño al montarse vacío. Los que llegan como root (Coolify, Railway, un bind
# mount) los arregla vocero-entrypoint.sh en cada arranque.
RUN mkdir -p /data/media && chown -R vocero:vocero /data

COPY --from=builder --chown=vocero:vocero /app/.next/standalone ./
COPY --from=builder --chown=vocero:vocero /app/.next/static ./.next/static
COPY --from=builder --chown=vocero:vocero /app/public ./public
COPY --from=builder --chown=vocero:vocero /app/migrate.bundle.mjs ./migrate.mjs
COPY --from=builder --chown=vocero:vocero /app/seed-demo.bundle.mjs ./seed-demo.mjs
COPY --from=builder --chown=vocero:vocero /app/ops ./ops
COPY --from=builder --chown=vocero:vocero /app/drizzle ./drizzle
# Nombre propio a propósito: la imagen de node ya trae su docker-entrypoint.sh
# (antepone `node` si el primer argumento no es un comando) y el nuestro le
# pasa la posta en vez de pisarlo.
COPY vocero-entrypoint.sh /usr/local/bin/vocero-entrypoint.sh
# sed: un checkout de Windows con autocrlf lo deja en CRLF y `sh` no lo corre.
RUN sed -i 's/\r$//' /usr/local/bin/vocero-entrypoint.sh \
    && chmod 755 /usr/local/bin/vocero-entrypoint.sh

# Sin `USER vocero`: el entrypoint baja a `vocero` con su-exec. Arrancado con
# `--user`, también funciona (y avisa si /data no es escribible).
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# start-period amplio: cubre las migraciones del arranque (una migración
# pesada puede pasar de 40 s; mientras dura, un fallo no cuenta)
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

# Operación 1 — APAGADO LIMPIO (spec 043, apagado.md). Antes el PID 1 era la
# shell de `sh -c`, que no reenvía SIGTERM: el contenedor moría por SIGKILL a
# mitad de lo que hiciera. Ahora:
# - `tini` es el PID 1: reenvía las señales (-g: a todo el grupo, también a
#   migrate.mjs si se apaga mientras migra) y recoge procesos huérfanos;
# - `exec node server.js`: Node reemplaza a la shell y recibe la señal;
# - NEXT_MANUAL_SIG_HANDLE: Next no instala su manejador (esperaría a cerrar
#   las conexiones SSE, que nunca se cierran solas); el nuestro
#   (src/server/shutdown.ts) termina lo que está en curso y sale en menos de
#   SHUTDOWN_GRACE_MS (25 s), dentro del «Stop grace period» de Coolify (30 s).
RUN apk add --no-cache tini
ENV NEXT_MANUAL_SIG_HANDLE=true
ENTRYPOINT ["/sbin/tini", "-g", "--", "vocero-entrypoint.sh"]
# Migrar al BOOT del contenedor nuevo y arrancar el server standalone
CMD ["sh", "-c", "node migrate.mjs && exec node server.js"]
