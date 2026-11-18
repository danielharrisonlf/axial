#!/bin/sh
# Roda uma vez a cada deploy, antes dos serviços: chaves, migrations e seed de demonstração.
# Tudo é idempotente: chaves existentes são preservadas, migrations aplicam só o que falta
# e o seed preserva registros já criados.
set -eu
cd /app
# o seed sobe o módulo da API: ele precisa da mesma configuração do serviço api
export JWT_PUBLIC_KEY_PATH="${JWT_PUBLIC_KEY_PATH:-/app/keys/dev-public.pem}"

echo "[setup] chaves de identidade"
node scripts/dev-identity.mjs init

echo "[setup] migrations: projects"
(cd apps/api && DATABASE_URL="${POSTGRES_URL}?schema=projects" node_modules/.bin/prisma migrate deploy)

echo "[setup] migrations: identity, notifications, audit"
(cd apps/ms-identity && IDENTITY_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)
(cd apps/ms-notifications && NOTIFICATIONS_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)
(cd apps/ms-audit && AUDIT_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)

if [ "${AXIAL_SEED:-true}" = "true" ]; then
  echo "[setup] seed de demonstração"
  (cd apps/api && DATABASE_URL="${POSTGRES_URL}?schema=projects" node_modules/.bin/tsx prisma/seed.ts)
fi

echo "[setup] pronto"
