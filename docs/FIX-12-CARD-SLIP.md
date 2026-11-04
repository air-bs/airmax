# Fix #12: card brand + last 4 after the receipt (branch `claude/receipt-card-brand`)

Not merged, not released. Print only: no change to how payments are charged, totaled or sent to AIR POS.

## Where the payment line comes from
- Every priced receipt (sale, Reprint Receipt, return) is a PDF that AIR POS renders from the store's bill template
  (`RetailOrderBillContentGet`, `app/lib/register.js` `receiptPdfs`). AirMax prints it unchanged (Windows driver or as a
  picture). AirMax does not build the receipt's payment line and cannot change it.
- Card results come back from AIR POS: card machine = `RetailOrderReceiveCheck` (polled in `pollCard`, `register.js`), read only
  for `isCompleted`, `message`, `subMessage`, `shouldReissue`; card on file / typed card = `RetailOrderReceiveBegin` reply.

## Options looked at (AirMax side)
| Option | Verdict |
|---|---|
| AirMax's own ESC/POS / StarLine receipt instead of the AIR POS PDF | Rejected: replaces the AIR POS receipt (big difference from Air Register, every AIR POS-printed field would have to be rebuilt); the store's Star futurePRNT queue refuses AirMax's direct path anyway |
| Add data before AIR POS renders the PDF | Only possible through the template's own text fields (`extraInfos`), i.e. only if the store's AIR POS template has such a field: dropped with the template path |
| **Second slip right after the receipt** | **Chosen**: same pattern as the sale note and the gift card list (`printSlip`: right commands for Star / Epson / generic, Windows driver fallback, AIR POS print service); no AIR POS change needed |

## What card data really exists
| Payment | Brand / last 4 available to AirMax? | Slip |
|---|---|---|
| Card on file (Keyed card with a saved card) | Yes: AIR POS saved-card record `cardType` + `lastFourDigits` (`cofCard`, already used for the saved-card list) | "VISA ****4242   $10.80"; no `cardType` -> "CARD ON FILE ****4242"; last 4 not 4 digits -> no slip |
| Card machine (terminal) | No: AIR POS's ReceiveCheck answer is only read for approved / declined; no real approved reply is recorded (TestShop has no card terminal), so its fields are unknown | none |
| Typed card, Stripe | No: the number is typed only into Stripe's box and never reaches AirMax | none |
| Typed card, Sola | Not kept: the typed number lives only in the one request and is wiped (by design); the brand would be a guess | none |

## What changed
- `app/lib/register.js` (3 blocks, 6 lines, additions only): `cofSaved` remembers the picked saved card's brand / last 4 (memory);
  the tender for it carries the slip label (non-enumerable: not in the journal, screen state or logs); `finishSale` saves the
  label per order (`card-slips.json`, newest 2000) so Reprint prints the slip too.
- `app/lib/extras.js` (2 blocks, 26 lines, additions only): `printCardSlip` after the receipt, note and gift card list in
  `printOrderOnce`; `cardSlipLabel`, `cardSlipLines`, `saveCardSlipFor`. Gift receipts never get it.
- `tests/backend-frozen.test.js`: strips `// airmax-fix-12+` ... `// airmax-fix-12-` blocks first; allowlist = exact block and line
  counts (register.js 3 / 6, extras.js 2 / 26, every other file 0); everything else still byte-identical to store 1.2.3.
- `tests/fake-server.js`: the fake AIR POS print service keeps what it printed (hook `/printed`), test only.
- `tests/card-slip-12.test.js` (new, in `run-all-look.sh`): label rules + the real server on the fake AIR POS.

## Not confirmed
- Not printed on a real printer (fake AIR POS print service only); the slip uses the same `printSlip` path as the sale note.
- Whether AIR POS itself could put brand / last 4 on its receipt (template fields, the terminal's data): not checked, path dropped.
- The card machine's real approved reply: no recording exists; if it carries card fields, a later change could use them.
