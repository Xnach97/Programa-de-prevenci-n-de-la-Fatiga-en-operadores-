#!/usr/bin/env bash
# =============================================================================
# supabase/tests/run-local.sh
# Aplica las migraciones 0001–0018 sobre un Postgres local descartable (con los
# stubs de Supabase) y ejecuta las pruebas de RLS , Organization, Scientific, Testing, Indicators, Rules y Audit y Research. Las migraciones se aplican
# DOS veces para comprobar idempotencia.
#
# Uso:  bash supabase/tests/run-local.sh
# Requiere: psql y acceso al usuario `postgres` (sudo/su) en el Postgres local.
# =============================================================================
set -euo pipefail

DB="neurolab_rls_test"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(su postgres -c)

run_sql_file() {
  "${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $1" >/dev/null
}

"${PSQL[@]}" "psql -q -c 'drop database if exists $DB;'"
"${PSQL[@]}" "psql -q -c 'create database $DB;'"

run_sql_file "$ROOT/supabase/tests/local_stubs.sql"

for pasada in 1 2; do
  for migracion in "$ROOT"/supabase/migrations/*.sql; do
    run_sql_file "$migracion"
  done
  echo "Migraciones aplicadas (pasada $pasada de 2)"
done

"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/rls.test.sql"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/organization.test.sql"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/scientific.test.sql"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/testing.test.sql"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/indicators.test.sql"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/rules.test.sql"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/audit.test.sql"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/research.test.sql"

# Bootstrap de la primera empresa/administrador (se aplica dos veces: idempotente)
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -c \"insert into auth.users (id, email) values ('a8000000-0000-0000-0000-000000000001', 'boot@test.co')\""
BOOT="$(mktemp /tmp/neurolab-bootstrap.XXXXXX.sql)"
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { generarBootstrap } from '$ROOT/scripts/instalar.mjs';
const plantilla = readFileSync('$ROOT/supabase/bootstrap.sql', 'utf8');
writeFileSync('$BOOT', generarBootstrap(plantilla, { empresa: \"O'Boot & Cía\", nit: '900-BOOT-1', email: 'boot@test.co', sembrar: true }));
"
chmod 644 "$BOOT"
run_sql_file "$BOOT"
run_sql_file "$BOOT"
rm -f "$BOOT"
"${PSQL[@]}" "psql -q -d $DB -v ON_ERROR_STOP=1 -f $ROOT/supabase/tests/bootstrap.test.sql"

"${PSQL[@]}" "psql -q -c 'drop database $DB;'"
