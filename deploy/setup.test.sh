#!/bin/sh
# Teste de deploy/setup.sh com prisma e tsx substituídos por stubs (nada toca banco):
# migration com falha falha o setup; seed com falha só avisa e o setup termina com sucesso.
# Uso: sh deploy/setup.test.sh (precisa de node no PATH, para scripts/dev-identity.mjs).
set -eu
setup="$(cd "$(dirname "$0")" && pwd)/setup.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

app="$work/app"
mkdir -p "$app/scripts"
: >"$app/scripts/dev-identity.mjs"
for svc in api ms-identity ms-notifications ms-audit; do
  mkdir -p "$app/apps/$svc/node_modules/.bin"
  for bin in prisma tsx; do
    cat >"$app/apps/$svc/node_modules/.bin/$bin" <<'STUB'
#!/bin/sh
svc=$(basename "$PWD")
echo "$svc $*" >>"$CALLS"
case "$*" in
  *migrate*) if [ "${FAIL_MIGRATE:-}" = "$svc" ]; then echo "Error: migration failed in $svc" >&2; exit 1; fi ;;
  *seed*) if [ "${FAIL_SEED:-}" = "$svc" ]; then echo "Error: seed failed in $svc" >&2; exit 3; fi ;;
esac
exit 0
STUB
    chmod +x "$app/apps/$svc/node_modules/.bin/$bin"
  done
done

failures=0
# run <nome> <status esperado> [VAR=valor ...]: roda o setup e guarda a saída em $out e as chamadas em $CALLS
run() {
  name=$1
  want=$2
  shift 2
  CALLS="$work/$name.calls"
  out="$work/$name.out"
  : >"$CALLS"
  status=0
  env CALLS="$CALLS" AXIAL_SETUP_DIR="$app" POSTGRES_URL="postgresql://stub/axial_dev" \
    AXIAL_DEMO_PASSWORD="demo-password-stub" "$@" sh "$setup" >"$out" 2>&1 || status=$?
  if [ "$status" -ne "$want" ]; then fail "$name: status $status, esperado $want"; fi
}
fail() {
  echo "FALHOU: $1" >&2
  [ -z "${out:-}" ] || sed 's/^/  | /' "$out" >&2
  failures=$((failures + 1))
}
has() { grep -q -- "$2" "$1" || fail "$name: falta '$2' em $(basename "$1")"; }
lacks() { if grep -q -- "$2" "$1"; then fail "$name: não devia ter '$2' em $(basename "$1")"; fi; }

run ok 0
has "$CALLS" "ms-identity src/seed-demo.ts"
has "$CALLS" "api prisma/seed.ts"
has "$CALLS" "ms-audit src/seed-demo.ts"
lacks "$out" "AVISO"
has "$out" "\[setup\] pronto"

run identity-seed-fails 0 FAIL_SEED=ms-identity
has "$out" "AVISO: seed de demonstração falhou: identity (código 3): Error: seed failed in ms-identity"
lacks "$CALLS" "api prisma/seed.ts"
lacks "$CALLS" "ms-audit src/seed-demo.ts"
has "$out" "\[setup\] pronto"

run projects-seed-fails 0 FAIL_SEED=api
has "$out" "AVISO: seed de demonstração falhou: projects"
has "$CALLS" "ms-identity src/seed-demo.ts"
lacks "$CALLS" "ms-audit src/seed-demo.ts"

run migration-fails 1 FAIL_MIGRATE=ms-audit
lacks "$CALLS" "seed"
lacks "$out" "\[setup\] pronto"

run no-password 0 AXIAL_DEMO_PASSWORD=
has "$out" "AVISO: AXIAL_SEED=true sem AXIAL_DEMO_PASSWORD"
lacks "$CALLS" "seed"
has "$out" "\[setup\] pronto"

run seed-off 0 AXIAL_SEED=false
lacks "$CALLS" "seed"
lacks "$out" "AVISO"

if [ "$failures" -ne 0 ]; then
  echo "setup.test.sh: $failures verificação(ões) falharam" >&2
  exit 1
fi
echo "setup.test.sh: migrations falhando bloqueiam o setup; seed falhando só avisa"
