#!/usr/bin/env bash
# Disposable-DB test for migrations/20261105_xera_bonus_referral_claimable.sql
# Usage: ./run_bonus_referral_claimable_test.sh [dbname]   (DROPS the target db - never use on Supabase)
set -euo pipefail
DB="${1:-xera_bonus_ref_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../migrations"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"

"$HERE/setup_xera_test_db.sh" "$DB" >/dev/null 2>&1
for f in 20261020_xera_official_mining_rewards 20261021_xera_official_launch_v1 \
         20261024_xera_kyc_fee_readiness_v1 20261025_xera_crypto_payments_v1 \
         20261027_xera_kyc_provider_v1 20261030_xera_mainnet_readiness_v1; do
  $P -f "$MIG/$f.sql" >/dev/null 2>&1
done

$P -f "$HERE/test_bonus_referral_claimable_seed.sql"
$P -f "$MIG/20261105_xera_bonus_referral_claimable.sql" 2>&1 | grep -i "notice\|error" || true
$P -f "$HERE/test_bonus_referral_claimable_after.sql"

# Re-running the migration must change nothing.
before=$($P -At -c "select mining_distributed from xera_allocations where id=1")
$P -f "$MIG/20261105_xera_bonus_referral_claimable.sql" >/dev/null 2>&1
after=$($P -At -c "select mining_distributed from xera_allocations where id=1")
[ "$before" = "$after" ] || { echo "FAILED: re-run changed mining_distributed ($before -> $after)"; exit 1; }
echo "re-run is a no-op: OK"

# A mismatch must STOP the migration and change nothing.
$P -c "update xera_allocations set mining_distributed = 33 where id=1"
if $P -f "$MIG/20261105_xera_bonus_referral_claimable.sql" >/dev/null 2>/tmp/mig_err.txt; then
  echo "FAILED: migration should have stopped on a mismatch"; exit 1
fi
grep -q "matches neither" /tmp/mig_err.txt || { echo "FAILED: wrong error"; cat /tmp/mig_err.txt; exit 1; }
[ "$($P -At -c 'select mining_distributed from xera_allocations where id=1')" = "33.0000" ] || { echo "FAILED: mismatch run changed data"; exit 1; }
echo "mismatch stops the migration: OK"

# The existing referral suite must still pass on the migrated schema (fresh db, migration applied).
"$HERE/setup_xera_test_db.sh" "${DB}_ref" >/dev/null 2>&1
for f in 20261020_xera_official_mining_rewards 20261021_xera_official_launch_v1 20261024_xera_kyc_fee_readiness_v1 20261025_xera_crypto_payments_v1 20261027_xera_kyc_provider_v1 20261030_xera_mainnet_readiness_v1 20261105_xera_bonus_referral_claimable; do
  psql -v ON_ERROR_STOP=1 -q -d "${DB}_ref" -f "$MIG/$f.sql" >/dev/null 2>&1
done
psql -v ON_ERROR_STOP=1 -q -d "${DB}_ref" -f "$HERE/test_referrals.sql" 2>&1 | grep -i "PASSED\|error" 
echo "ALL BONUS/REFERRAL CLAIMABLE TESTS PASSED"
