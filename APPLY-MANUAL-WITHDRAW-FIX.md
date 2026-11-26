# Withdraw to a typed address: any wallet can confirm, an empty wallet connection reconnects

One file, frontend only (no SQL, no backend):
  hub-frontend/src/js/xera-chain.js

Deploy the Hub frontend.

## What was wrong
Pressing Withdraw on a typed address required the connected wallet account to BE that address.
When the wallet connection shared no account at all (expired WalletConnect session, wallet app closed), the page
still said "connected as a different account ... open the wallet that owns the saved address".

## What it does now
- The wallet you connect only confirms the transaction and pays the BNB network fee. The XERA always goes to the
  saved address (the contract sends it to the address inside the server-signed claim, whoever submits it).
- If the wallet connection shares no account, the wallet picker opens again. If it still shares nothing you get a
  clear message and NOTHING is reserved.
- The page no longer checks the BNB balance of the saved address (it is not the one that pays); the fee check is done
  on the wallet that will actually confirm.
- Unchanged: the waiting period, the password, the address confirmation popup, KYC + first-transfer fee, and
  one address per account. Connected (verified) wallets work as before.
