# Profile tab: Delete as a bin tile, Sign out in the grid

Copy these two files over your project (same paths). Frontend only: no SQL, no backend.
  hub-frontend/src/pages/xera/index.html
  hub-frontend/src/css/xera.css

Then deploy the Hub frontend.

## What changed
- The big "Delete account" card is now a small bin tile in the "More" grid (same size as Rewards, Agreement...).
  Tapping it opens the same deletion popups as before. Nothing in the deletion flow changed.
- Sign out is a tile in the same grid (exit icon), no longer a full-width button.
- When a deletion is scheduled, the bin tile is replaced by a full-width card in the grid with the date and "Cancel deletion".
- If deletion is blocked or paused, the reason shows full width under the tiles and the bin is greyed out.
- The tile appears only after the server answers (same as the old card).

Note: this file set is built on top of the zip you sent (it includes the deletion v3 JS only if you applied that zip; the grid works with or without it).
