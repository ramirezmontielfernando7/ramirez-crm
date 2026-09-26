#!/usr/bin/env bash
# Arranca la instancia LOCAL de marketing: migraciones + next start (build de
# producción) + sidecar de mocks. Requiere `pnpm build` previo y .env.marketing.
set -euo pipefail
cd "$(dirname "$0")/../.."
LOG=${LOG_DIR:-/tmp/vocero-marketing}; mkdir -p "$LOG"
MIGRATIONS_DIR=./drizzle node --env-file=.env.marketing scripts/migrate.mjs
npx esbuild scripts/marketing/mock-server.ts --bundle --platform=node --format=esm \
  --outfile=scripts/marketing/.build/mock-server.mjs --alias:@=./src --packages=external --log-level=warning
# Por puerto: Next renombra su proceso a "next-server" y un pkill por nombre falla.
fuser -k 3000/tcp 4010/tcp > /dev/null 2>&1 || true
sleep 1
NODE_ENV=development MOCK_PORT=4010 nohup node --env-file=.env.marketing \
  scripts/marketing/.build/mock-server.mjs > "$LOG/mock.log" 2>&1 &
nohup node --env-file=.env.marketing node_modules/next/dist/bin/next start -p 3000 \
  > "$LOG/app.log" 2>&1 &
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:3000/api/health > /dev/null && { echo "app lista"; exit 0; }
  sleep 1
done
echo "la app no respondió"; tail -30 "$LOG/app.log"; exit 1
