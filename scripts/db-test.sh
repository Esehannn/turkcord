#!/usr/bin/env bash
# Veritabanı migration'larını ve güvenlik testlerini boş bir Postgres'te çalıştırır.
# Kullanım: TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
# Dikkat: Hedef veritabanı her seferinde sıfırlanır. Canlı veritabanını ASLA vermeyin.
set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL tanımlı değil (boş bir test veritabanı olmalı)}"

root="$(cd "$(dirname "$0")/.." && pwd)"
db_name="turkcord_test"
admin_url="$TEST_DATABASE_URL"

psql "$admin_url" -v ON_ERROR_STOP=1 -q -c "drop database if exists $db_name with (force)" -c "create database $db_name"
for role in anon authenticated service_role; do
  psql "$admin_url" -q -c "drop role if exists $role" >/dev/null 2>&1 || true
done

base="${admin_url%%\?*}"
query="${admin_url#"$base"}"
test_url="${base%/*}/$db_name$query"
run() { psql "$test_url" -v ON_ERROR_STOP=1 -q -X "$@"; }

run -f "$root/supabase/tests/supabase_stubs.sql"
for f in "$root"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  run -f "$f"
done
run -t -A -f "$root/supabase/tests/rls_test.sql" 2>&1 | sed -e "s/^psql:[^ ]* NOTICE:  /  /" -e "/^\s*$/d"
