# XERA Blockchain — Hardening Status

**Status: BNB ACTIVE PATH — FINAL TEST EXECUTION PENDING. TON — COMING SOON. MAINNET — NOT READY.**

The active launch path is BNB Smart Chain. TON remains intentionally disabled
in the user-facing application until its settlement implementation is fully
verified. This document distinguishes previously recorded test results from
the current local verification environment.

---

## 1. Verified test results

All of these were run in this repository. Commands are in section 6.

| Suite | Result | What it proves |
|---|---|---|
| BNB Hardhat contracts | **NOT RUN in current environment** | Token supply, 25/75 split, EIP-712 signing, replay/cap/pause/role controls, vesting math, Merkle migration |
| Backend pytest | **33/33 passing** | EIP-712 + TON signers, wallet-link verification, claim reservation, error mapping |
| Supabase SQL (real Postgres 16) | **16/16 assertions** | Global 75M cap, claim state machine, retry-without-replay, nonce binding |
| Supabase concurrency (real parallel sessions) | **2/2 passing** | Cap and nonce races both serialize correctly |
| Supabase privilege model | **7/7 passing** | anon/authenticated can't reach tables or RPCs; service_role can |
| TON claim-signature cross-verification | **4/4 passing** | Python-produced signature accepted by the real compiled Tact contract |
| TON settlement integration | **8/9 passing** | Mint cap, admin controls, expiry, replay, pause, signer rotation — **but see section 3** |

---

## 2. Real bugs found and fixed

### 2.1 TON claims could never settle (critical, fixed)

`mining_distributor.tact` sent settlement leg 1 with an explicit value and
`SendPayGasSeparately`, then leg 2 with `SendRemainingValue`.
`SendRemainingValue` computes the remaining *inbound* value **without**
subtracting what leg 1 already committed, so the two actions always
over-committed the message balance.

Observed identically at 0.5, 1, and 2 TON attached:
`exitCode: 0` (compute succeeded), `actionResultCode: 37` ("Not enough
Toncoin"), `aborted: true`.

Because the action phase aborts the whole transaction, **no funds were
ever at risk and no referenceId was burned** — but not a single TON claim
could ever have succeeded. Invisible to the Tact compiler.

Fixed: both legs now use explicit values with `SendPayGasSeparately`, plus
a `require` on attached gas and a `claim_gas_requirement()` getter so the
frontend reads the requirement from the contract instead of hardcoding it.

### 2.2 TON Claim message exceeded the cell size limit (critical, fixed)

opcode(32) + queryId(64) + address(267) + coins + referenceId(256) +
deadline(64) + a 512-bit signature exceeds a TON cell's 1023-bit capacity.
The message was unconstructible. Fixed by moving the claim fields into a
ref cell; the *signed payload* is unchanged, so the signer was unaffected.

### 2.3 Supabase RPCs were callable by anon (critical, fixed)

`REVOKE EXECUTE ... FROM anon, authenticated` does nothing, because
Postgres grants `EXECUTE` to `PUBLIC` by default and both roles inherit
through it. Before the fix, an anon-key holder could call
`xera_reserve_onchain_claim` or `xera_link_external_wallet` for **any**
user_id via PostgREST, bypassing every FastAPI authorization check.
Fixed with `REVOKE ... FROM PUBLIC`; verified both attacks now fail.

### 2.4 Wallet-link nonce had a TOCTOU race (fixed)

`consume_nonce` did SELECT-then-UPDATE, so two concurrent requests with the
same nonce could both pass. Replaced with a single atomic conditional
UPDATE (`xera_consume_wallet_nonce`). Verified with two genuinely parallel
sessions: exactly one wins.

---

## 3. Current launch scope

BNB Smart Chain is the only active blockchain settlement option in the
frontend. TON is displayed as **Coming Soon** and its wallet/claim controls
are disabled.

The BNB source and test suite are present, but the current archive's checked-in
Node dependency tree is incomplete, so Hardhat could not be executed in this
environment. A complete dependency install followed by the full Hardhat suite
is required before calling the BNB contracts production-ready.

## 4. TON OPEN BLOCKER — mint credits a zero balance

The one failing test is the most important one on the TON side:

```
✕ settles a valid claim with an exact 25/75 split
```

What's confirmed working: the distributor's jetton wallet address derives
**identically** from the minter and from the distributor
(`EQBeoaobkalK...` from both), and after `Mint` the wallet **does** deploy.

What's broken: the wallet's balance is **0** after minting. The
`JettonTransferInternal` from the minter is not crediting the recipient.
Likely candidates (not yet diagnosed — do not assume):

* the receiving wallet's sender-authorization check rejecting the minter
* value/gas handling on the mint's outbound message
* a field mismatch in `JettonTransferInternal` between minter and wallet

**Consequence: the core TON value flow — mint → distributor → 25/75 split
→ vesting tranche — has never once been demonstrated end-to-end.** Until
this passes, the TON side is unproven no matter what compiles or what the
other 8 tests show.

This is deliberately left failing rather than skipped or asserted around.

---

## 5. Known gaps (not bugs — absent work)

* **TON confirmation indexer** (`verify_ton_claim_tx`) is written but has
  never run against a live TON RPC. No network path in the build
  environment.
* **Phase 11 TON vesting edge cases** — no tests for release at the
  halfway point, at exact completion, repeated release, multiple tranches,
  malicious notifications, or bounced transfers.
* **Bounce handlers** — no `bounced(...)` receiver exists on any TON
  contract. Given 2.1, settlement legs that bounce post-commit have no
  recovery path on-chain. Needs design work, not just a test.
* **Type safety in TON tests** — the `as any` casts on Tact message
  literals silently swallowed a wrong field name during this session
  (`to` vs `receiver`). They hide real type errors and should be removed.
* **Static analysis** — Slither/Mythril not run.
* **Deployment manifest** (Phase 14) and **formal report** (Phase 16) not
  written.
* **Multisig/timelock contracts** not deployed; the contracts take their
  addresses as constructor arguments but nothing deploys them.

---

## 6. Canonical configuration

Single source of truth: `blockchain/xera-economics.json`.

```
Total supply            500,000,000 XERA
  BNB chain cap         400,000,000
  TON chain cap         100,000,000   (sum validated by a DB trigger, fails closed)

Ecosystem allocation
  Public                425,000,000
  EVOXERA Technology     75,000,000

Mining allocation        75,000,000   GLOBAL across both chains
Claim split              25% transferable / 75% vested
Vesting duration         180 days
Bridge                   none
```

**The 75M mining cap is global, enforced by a row-locked counter in
Postgres** (`xera_mining_allocation_state`), not by the per-chain contract
caps. Each chain's contract `maxAllocation` is an independent secondary
ceiling — the two do **not** sum to the global cap and must never be read
as if they did.

---

## 7. Running the tests

```bash
# BNB contracts (solc comes from npm; no external download needed)
cd blockchain/bnb && npm install && npx hardhat test

# TON contracts
cd blockchain/ton && npm install && npm run build && npx jest

# Backend
cd python && pip install -r requirements.txt && python3 -m pytest

# Supabase — needs a real disposable Postgres; see supabase/tests/README.md
psql -d xera_test -f supabase/tests/test_global_mining_cap.sql
./supabase/tests/run_concurrency_test.sh localhost xera_test postgres
./supabase/tests/run_privilege_test.sh   localhost xera_test postgres
```

`node_modules/` is excluded from the archive — `npm install` restores it.

---

## 8. Before testnet

1. Fix section 3 and get the 25/75 integration test passing.
2. Write the Phase 11 TON vesting edge-case tests.
3. Design and implement bounce handling on the TON settlement legs.
4. Remove the `as any` casts from the TON test suites.
5. Run the TON confirmation indexer against a real testnet RPC.
6. Run Slither/Mythril on the Solidity contracts.
7. Deploy the multisig/timelock contracts.

Mainnet is further out than testnet, and nothing here should be read as
mainnet-ready.
