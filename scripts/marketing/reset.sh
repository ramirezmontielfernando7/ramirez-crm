#!/usr/bin/env bash
# Reinicio TOTAL de la instancia local de marketing: BD vacía → migraciones →
# app (next start) + mocks → siembra. Solo toca la BD local de .env.marketing.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env.marketing; set +a
case "$DATABASE_URL" in
  *127.0.0.1:5433/vocero_marketing*) ;;
  *) echo "DATABASE_URL no es la BD local de marketing; aborto"; exit 1 ;;
esac
psql -h 127.0.0.1 -p 5433 -U postgres -q -c "drop database if exists vocero_marketing with (force)" -c "create database vocero_marketing"
rm -rf "$MEDIA_DIR" && mkdir -p "$MEDIA_DIR"
node scripts/marketing/assets.mjs
./scripts/marketing/start-app.sh
npx esbuild scripts/marketing/seed.ts --bundle --platform=node --format=esm \
  --outfile=scripts/marketing/.build/seed.mjs --alias:@=./src --packages=external --log-level=warning
node --env-file=.env.marketing scripts/marketing/.build/seed.mjs
