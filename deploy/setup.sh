#!/bin/sh
# Roda uma vez a cada deploy, antes dos serviços: chaves, migrations e seed de demonstração.
# Tudo é idempotente: chaves existentes são preservadas, migrations aplicam só o que falta
# e o seed só insere o que falta (ids determinísticos), sem alterar nem apagar registros.
set -eu
cd /app
echo "[setup] chaves de identidade"
node scripts/dev-identity.mjs init

echo "[setup] migrations: projects"
(cd apps/api && DATABASE_URL="${POSTGRES_URL}?schema=projects" node_modules/.bin/prisma migrate deploy)

echo "[setup] migrations: identity, notifications, audit"
(cd apps/ms-identity && IDENTITY_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)
(cd apps/ms-notifications && NOTIFICATIONS_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)
(cd apps/ms-audit && AUDIT_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)

if [ "${AXIAL_SEED:-true}" = "true" ]; then
  # cenário fictício Vetor Labs (packages/demo-fixtures), na ordem identity -> projects -> audit;
  # cada seed escreve só o próprio schema e exige banco *_dev e NODE_ENV diferente de production
  # TODO(identity): rodar o seed do ms-identity aqui, antes de projects, quando ele existir
  echo "[setup] seed de demonstração: projects"
  (cd apps/api && DATABASE_URL="${POSTGRES_URL}?schema=projects" node_modules/.bin/tsx prisma/seed.ts)
  echo "[setup] seed de demonstração: audit"
  (cd apps/ms-audit && AUDIT_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/seed-demo.ts)
fi

echo "[setup] pronto"
