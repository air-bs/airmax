# F4 New price on multi-buy and weighed items (branch `claude/f4-multibuy`)

approved Nov 3 2026 (frozen-file exception for `app/lib/register.js`, this fix only). Not merged, not released.

## Problem (found by the 2,640-combination sweep, Nov 3)
F4 "New price" was kept as a percent of the line. When the quantity crossed a multi-buy price point the per-item base price
changed under it: new price $8 at qty 1 on a "$10, 3 or more $9 each" item became $7.20 each at qty 3 (line $21.60, not $24);
set at qty 3 then qty 2 gave $8.89 each. Weighed items could be a cent off (1.5 lb at $3.99/lb = $5.98, not $5.99).

## Fix (`app/lib/register.js`, tag `f4m1011`: 1 changed line, 4 added)
- F4 New price remembers the typed price per item (on the line in memory, and on this PC in f4-prices.json since `d22df6e`; never sent to AIR POS, not in the journal).
- On every quantity change (Set Qty, +/-, scanning the same item again) the line discount is worked out again as
  line total minus new price x quantity, in whole cents (399 c x 1.5 lb = 598.5 c -> 599 c). It never goes below $0: if the
  multi-buy price is already lower than the typed price, the customer pays the multi-buy price.
- F4 % off, $ off or Remove item discount forget the remembered price. A refused new price keeps the earlier one.
- Unchanged: it is still the existing $-off line discount AIR POS already gets; the item price is never changed; plain items
  give exactly the same result as before (2,640 / 2,640 combinations).

## Tests
- New `tests/f4-multibuy-1011.test.js` (13 checks, in `run-all-look.sh`): multi-buy up / down / typed price above the multi-buy
  price, two weighed items, clearing and switching, the AIR POS line equals the $-off line with no extra field, memory only,
  item price unchanged, and the 2,640-combination sweep. On master's register.js it fails 4 of 13.
- `tests/backend-frozen.test.js`: one new entry `f4m1011` (the 1 original F4 line it replaces + 4 added lines); every other
  line of app/lib is still checked byte-identical to store Air Register 1.2.3.

## Matching Air Register change (store repo NOT touched)
Air Register's `app/lib/register.js` is the same file. To keep the two apps matched, the same 5 lines (tag `f4m1011`) go into
Air Register's register.js, together with the existing f4p1011 F4 New price line if Air Register does not have it yet, and
its backend-frozen equivalent. Until then AirMax and Air Register differ on F4 New price for multi-buy and weighed items.

## Not confirmed
- Whether the stores have multi-buy prices in AIR POS (the fake server has none; tested against a mocked AIR POS that applies
  the multi-buy unit price the way AirMax saves it). How real AIR POS totals a multi-buy line was not checked on TestShop.

## Independent review (Nov 3, branch `claude/f4-multibuy-review`)
Reviewed commit `4a529b6`; edge-case tests in `tests/f4-multibuy-edge.test.js` (20/20 pass; 7/20 on master's register.js).
Correct: + / - keys, scanning the same item again, a new price typed at the multi-buy quantity, large qty, $0 / $0.01 prices,
fractional and weighed quantities with a multi-buy, the multi-buy winning when it is lower, order discount, Tax Off,
refused $ off / % off / blank price keep the new price, back to the original price clears it, other lines untouched, nothing
new sent to AIR POS or written to aside.json, and a restore never changes a price by itself.

**Bug found (one cause, 3 places), FIXED in `d22df6e` (approved Nov 3, 1.0.11):** the typed price was kept only on the line in
memory, so it was lost whenever the sale's lines were rebuilt, and the next quantity change went back to the old % rule:
Put Aside -> Load Aside ($8 at qty 1, then qty 3 = $21.60, not $24; a $9.50 price beaten by the multi-buy came back at the full
$10), restart / crash recovery (lines from the journal), Hold -> Load Hold (lines from AIR POS).
Fix (`register.js`, same tag `f4m1011`, now 1 changed + 20 added lines): the typed price is also kept on this PC in
`f4-prices.json` (line id -> price and time; no name, customer or card data; entries dropped after 45 days; a damaged file is
ignored). A custom-discount line that comes back without it (same line id) gets it back. On the line it stays a hidden property,
so the journal, aside.json and every AIR POS request still never carry it. % off / $ off / Remove discount / back to the original
price forget it there too. Tests: `tests/f4-multibuy-edge.test.js` 35/35 (the 4 cases fail on `4a529b6`), incl. restarts,
weighed + multi-buy after a restore, return with receipt (refund = what was paid per item) and reprint.
Limits: kept per PC (a sale held on another register comes back with the old rule); Load Hold relies on AIR POS returning the
same line ids and the line's custom discount (true for the fake server and for how AirMax saves it; not checked on TestShop).
Air Register: the same `f4m1011` lines would be needed in its `register.js` to stay matched.

**Owner decision (Nov 3): keep the current behaviour.** Typing the multi-buy price as the new price on a line that already has a
typed price (qty 3, $9) is "same as the original, no discount": the multi-buy price replaces the typed price, which is forgotten
(in memory and in f4-prices.json), so later qty changes use the store prices (qty 1 = full $10). Pinned by D1-D4 in
`tests/f4-multibuy-edge.test.js`, also over Put Aside / restart / Load Aside.
