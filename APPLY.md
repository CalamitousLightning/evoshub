# Withdraw chip fix
Copy over the same paths (no backend, no migration):
- hub-frontend/src/pages/xera/index.html   (both Withdraw chips marked; built on your latest copy)
- hub-frontend/src/js/xera.js              (small block in applyOnchainGate: Withdraw shows SOON while on-chain is closed, links to /xera-wallet.html once it is open)
