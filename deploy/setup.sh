#!/bin/sh
# Roda uma vez a cada deploy, antes dos serviços: chaves, migrations e seed de demonstração.
# Chaves existentes são preservadas e migrations aplicam só o que falta; uma falha em qualquer
# delas falha o setup, para os serviços não subirem sobre um schema sem migrar.
# O seed de demonstração escreve só na primeira execução de cada serviço (depois responde
# "already seeded" e não restaura nada que tenha sido alterado ou apagado) e nunca bloqueia o deploy:
# se falhar, o setup avisa em voz alta e termina com sucesso mesmo assim.
set -eu
# AXIAL_SETUP_DIR só existe para o teste deploy/setup.test.sh; no contêiner é sempre /app.
cd "${AXIAL_SETUP_DIR:-/app}"
echo "[setup] chaves de identidade"
node scripts/dev-identity.mjs init

echo "[setup] migrations: projects"
(cd apps/api && DATABASE_URL="${POSTGRES_URL}?schema=projects" node_modules/.bin/prisma migrate deploy)

echo "[setup] migrations: identity, notifications, audit"
(cd apps/ms-identity && IDENTITY_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)
(cd apps/ms-notifications && NOTIFICATIONS_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)
(cd apps/ms-audit && AUDIT_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/migrate.ts)

# Um passo do seed: nome, diretório e comando. Depois da primeira falha os passos seguintes são
# pulados (projects e audit dependem do identity); a falha vira aviso, não erro do setup.
seed_failed=""
seed_step() {
  name=$1
  dir=$2
  shift 2
  [ -z "$seed_failed" ] || return 0
  echo "[setup] seed de demonstração: $name"
  status=0
  (cd "$dir" && "$@") 2>"$seed_errors" || status=$?
  cat "$seed_errors" >&2
  if [ "$status" -ne 0 ]; then
    reason=$(grep 'Error' "$seed_errors" | head -n 1 || true)
    [ -n "$reason" ] || reason=$(tail -n 1 "$seed_errors")
    seed_failed="$name (código $status): ${reason:-sem mensagem de erro}"
  fi
}

if [ "${AXIAL_SEED:-true}" = "true" ]; then
  # cenário fictício Vetor Labs (packages/demo-fixtures), na ordem identity -> projects -> audit;
  # cada seed escreve só o próprio schema e exige banco *_dev e NODE_ENV diferente de production
  if [ -z "${AXIAL_DEMO_PASSWORD:-}" ]; then
    echo "[setup] AVISO: AXIAL_SEED=true sem AXIAL_DEMO_PASSWORD (10 a 128 caracteres): seed de demonstração pulado." >&2
    echo "[setup] AVISO: se o demo já foi semeado, nada muda; senão, as contas de demonstração não existem até" >&2
    echo "[setup] AVISO: um deploy com AXIAL_DEMO_PASSWORD definida (ou desligue o seed com AXIAL_SEED=false)." >&2
  else
    seed_errors=$(mktemp)
    seed_step identity apps/ms-identity env IDENTITY_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/seed-demo.ts
    seed_step projects apps/api env DATABASE_URL="${POSTGRES_URL}?schema=projects" node_modules/.bin/tsx prisma/seed.ts
    seed_step audit apps/ms-audit env AUDIT_DATABASE_URL="$POSTGRES_URL" node_modules/.bin/tsx src/seed-demo.ts
    rm -f "$seed_errors"
    if [ -n "$seed_failed" ]; then
      echo "[setup] ==================================================================" >&2
      echo "[setup] AVISO: seed de demonstração falhou: $seed_failed" >&2
      echo "[setup] AVISO: os serviços sobem mesmo assim; veja o erro completo acima." >&2
      echo "[setup] ==================================================================" >&2
    fi
  fi
fi

echo "[setup] pronto"
