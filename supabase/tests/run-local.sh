#!/usr/bin/env bash
# =============================================================================
# supabase/tests/run-local.sh
# Aplica las migraciones 0001–0008 sobre un Postgres local descartable (con los
# stubs de Supabase) y ejecuta las pruebas de RLS , Organization y Scientific Engine. Las migraciones se aplican
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

"${PSQL[@]}" "psql -q -c 'drop database $DB;'"
