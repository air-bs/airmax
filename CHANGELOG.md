# Changelog

## AirMax 1.0.11 (release candidate, NOT published; version 1.0.11 in app/update.json; Gordon/Ari OKs Nov 1-2 2026)

Branch release/1.0.11-candidate. Not tagged, not on any download link or update feed.
- Ctrl+Shift+P (and the left Print Label button) opens the several-items Print Labels screen (pick a layout, label price; changes the printout only). Ctrl+Alt+L is gone. Button and shortcut label text unchanged.
- Speed: adding an item shows the line at once and the total is checked in the background (latest answer wins). Every other step waits for the total first and a stale total is never paid on. Same AIR POS calls and money math; tests compare 12 sample sales (discounts, Tax Off, gift cards, cash change) against the 1.0.11 base: identical.
- Tax on temporary items: Temporary Item "Taxable" switch (on by default) uses the store's AIR POS sales tax (never a typed rate); off = no tax; F5 Tax Off still wins. Tax picker in Settings > Returns (manager).
- Multi gift card: several gift cards are ONE gift card payment (a second gift card payment on the same sale is refused before anything is sent), and after a cash / check / gift card / store credit payment the order is read back so only what AIR POS really kept is counted. Nothing is ever re-sent.
- F4 discount on one item: % off, $ off or New price (sent as the existing $ off line discount; a price above the original is refused; the item price is never changed).
- Stuck paid sale fix (reported on a live-store sale): order % discount amount recalculated over all lines before every Save/Hold/Complete; AIR POS due compared with ours before any payment; Complete refusal re-sent once; failure reason kept, logged and shown.

## AirMax 1.0.10 (release, Ari OK 3:46 PM ET Nov 1 2026) = 1.0.10-local.2 code

Release installer pkg/out/1.0.10/AirRegister-AirposLook-Setup-1.0.10.exe; app/update.json = 1.0.10.
local.2 build (same code, not published):

Installer pkg/out/1.0.10-local.2/AirRegister-AirposLook-Setup-1.0.10-local.2.exe, 26,934,518 bytes,
sha256 f8bea0d1e5154cd9ebc60b49d0a941fd94955c2339301e169b208fd0a6a2a2e2. app/update.json stays 1.0.9.
Full suite 3:25 PM ET Nov 1: 92/92 test files exit 0 (log tests/results/local2-suite-full.txt).
- Star TSP143 driver receipts fit the printable width; helper 1.2.1 (identity check locks only deviceInfo + Device class).
- Check printers; label "why it did not print" messages; Reprint last receipt; gift receipt reprint.
- Label name XL / 2 lines / Hebrew right-to-left; Print Label quick settings.
- Settings "Print receipt after every sale"; one Enter = next sale; one Enter = add customer.
- Out-of-stock warning switch, default OFF; stores known to refuse below-zero stock still warn BEFORE any card (learned per store).
- Cash drawer opens by default only when cash or a check was taken (card-only sales: no kick); Star drawer via the driver.
- Receipt speed: printing starts on payment confirmed (about 2.8 s to 0.8 s on the fake printer).
- Split card fix (Ari OK 2:03 PM ET Nov 1): a card approved for part of the sale no longer sticks the screen; typed cash goes on.
  "Take payment anyway" keeps the lines queued behind the card.
- Logout with payments already taken on an unfinished sale needs a second press (payments kept, sale back after login).
- Refused Finish (not enough stock) says: payments are kept, add stock for <item> in AIR POS back office, then Finish sale.

## AirMax 1.0.10 UI (branch ui-1010, merged into master with the 1.0.9-local.2 money fixes Oct 30; local only, NOT published)

Plan: PLAN-ui-1010.md. Ari OK 11:12 AM ET Oct 30. No money / payment / total / tax / refund code changed; app/lib untouched.
- Customer screen welcome picture: Settings > "Customer screen welcome picture" (Choose picture… / Remove picture,
  "How the picture fits the screen": Show the whole picture (default) or Fill the whole screen, colour of the bars).
  PNG or JPEG only, checked by the file's bytes, up to 5 MB and 4096 x 4096. Shown full screen only on the Welcome
  screen (no sale in progress), in place of the Welcome message and logo. Manager only. Saved per PC in the data folder.
- Register screen logo above the total: Settings > "Register screen logo (above the total)" (Choose register logo… /
  Remove register logo). Same file rules. 72 px band (60 px at 1100 px wide or less); nothing changes when none is set.
- Hold and Load Hold each on their own line (same labels and shortcuts).
- Customer screen: "Please use the card reader" + the amount the card reader is asking for, while a terminal card
  payment waits (display only; not for keyed / card-on-file cards).
- Tests: tests/screenpics-1010.test.js, tests/e2e-ui-1010.js (in tests/run-all-look.sh); runner ports movable by env.

## Air Register (AIR POS look) 1.0.9 = AirMax 1.0.9 (built locally Oct 30 2026, NOT published)

Final check: see TEST-RESULTS.md (1.0.9 section).
- Card on file (Ari OK 1:25 AM ET Oct 30, plan /workspace/airpos-look-backups/card-on-file-mockup/PLAN-card-on-file.md):
  - Stripe stores only (Sola and no-channel stores: no section, and the server refuses).
  - Added only from the customer profile: "Cards on file" box, Add card… (name / address / ZIP prefilled from the customer,
    card typed into Stripe's own card box, consent tick box, Save off until ticked), Remove (asks "are you sure" first).
    Flow: RetailMemberCardAddBegin → Stripe confirmCardSetup → RetailMmeberCardAddComplete (card fields blank); list = RetailMemberCardSelect;
    remove = RetailMemberCardDelete. Any cashier can add, remove and charge.
  - Checkout: under Manual Credit (label kept), the saved cards of the customer on the sale; none preselected; cards saved under
    another payment channel greyed and not pickable. Paying sends ReceiveBegin paymentType 30 with retailMemberCardId and the masked
    card ('**** **** **** 1234', exp, '***'); the card is checked again with AIR POS first ("Nothing was charged" if not usable).
  - No "Remember card" at checkout: recordCreditCard stays false. A typed new card works exactly as before.
  - Never logged: SetupIntent client secret, card data, Stripe keys (the secret goes only to the screen, in memory).
- Team Kit money fixes (Ari OK 2:07 AM ET Oct 30), smallest change each:
  - (a) Amount order discount + items changed afterwards: tax was still cut by the % worked out when the discount was set
    ($10 off $100, then $200 of items at 8.875%: tax 15.98 instead of 16.86, $0.88 short). register.js recalc: ONE added line
    (tagged // mon109+) re-works orderDiscount % = discount $ / current items for an Amount discount before tax. Percent
    discounts, line discounts, promotions, points, payments and refunds unchanged.
  - (b) Clock In / Clock Out: "1,250.00" or "$100" went to AIR POS as $0. app.js cashNum() reads "$", spaces and thousands
    commas; anything else (blank, "1.250,00", "-5", 3 decimals) is refused with "Enter the cash amount as a number, like
    1250.00 or $100." and nothing is sent.
  - Tests: new tests/money-109.test.js (38), tests/e2e-clock-amount-109.js (7); fake-server records ClockIn/ClockOut (/clock-state);
    backend-frozen allows exactly the one mon109 line.
- Remove card fix (Ari OK 2:41 AM ET Oct 30): Remove sent RetailMemberCardDelete { retailMemberId, id }; real AIR POS (TestShop)
  answered success but kept the card. It now sends { retailMemberId, cardId } like the AIR POS app (one line in app/lib/airpos.js).
  The fake server now needs cardId (no cardId = success but nothing removed, like the real one), so the old field fails the e2e test.
- Files: app/lib/airpos.js (4 wrappers), app/lib/register.js (cof109 block; tender: one added line + retailMemberCardId on the submit),
  app/server.js (4 routes), app/public/extras.js (profile box, Add card dialog), app/public/app.js (checkout picker, Esc in Add card),
  app/public/index.html (CSS), app/update.json, pkg/Read Me.txt.
- Tests: new tests/e2e-card-on-file-109.js (in run-all-look.sh); tests/fake-server.js (card routes, /cof hooks, stripe keyed mode,
  made-up address for customer 5550100); tests/backend-frozen.test.js (allows exactly the marked cof109 lines).

## Air Register (AIR POS look) 1.0.8 = AirMax 1.0.8 (built locally Oct 30 2026, NOT published)

Final check: see TEST-RESULTS.md (1.0.8 section).
- Payment pop-up (Ari OK 12:50 AM ET Oct 30, mock-up /workspace/airpos-look-backups/payment-popup-mockup/):
  - Payment, refund, split payments and the 1.0.6 "sale not finished" states open as one centred pop-up
    (900px wide, or the window width minus 48px when smaller) over the dimmed sale screen with the 1.0.7 boxes.
  - The dim layer blocks the sale: tapping outside the pop-up does nothing. Esc / Back (Esc) work as before
    (with money already paid: "Back to sale (payments kept)").
  - Notes now say "Press Back (Esc) to add items" (payment) and "press Back (Esc) to change items" (refund)
    instead of "tap the sale".
  - Same buttons, same key labels, same 1.0.2 refund line/button sizes. Not built (not approved): two-line Hold buttons, logo.
  - CSS/layout and the two note texts only: no payment, refund, money, tax, server or register.js change.
- Files: app/public/index.html (1.0.8 pop-up CSS replaces the side-panel CSS; the 1.0.7 "beside the panel" box sizes removed),
  app/public/app.js (two note texts), app/update.json, pkg/Read Me.txt.
- Tests: new tests/e2e-popup-108.js (in run-all-look.sh, strict fake). Old side-panel checks updated to the pop-up:
  tests/e2e-side-panel.js, tests/e2e-refund-panel.js, tests/e2e-120.js, tests/e2e-look.js, tests/e2e-wide-customer-107.js.

## Air Register (AIR POS look) 1.0.7 = AirMax 1.0.7 (built locally Oct 30 2026, NOT published)

Final check: see TEST-RESULTS.md (1.0.7 section).
- Wide customer boxes (Ari OK 12:30 AM ET Oct 30, mock-up option A: across the sale area, not the full window):
  - The three boxes under the sale are wider and about 82px tall: Customer add (F3), Items (Esc), Checkout (F12).
    "Member Scan" is now "Customer add". Same buttons, same keys, same actions.
  - Customer card in the first box: name, Account (the availableBalance AIR POS gave when the customer was added; green,
    red at $0.00 or less), Phone, Points. No customer: "Scan card, phone or tap to add".
  - The small customer tag above the cart is kept and still opens the customer. Payment panel width unchanged. No MOCK-UP tag.
  - Display only: no server, register.js, money, payment, tax or stored-data change.
- Files: app/public/app.js (label, tileCustCard()), app/public/index.html (1.0.7 CSS block), app/update.json, pkg/Read Me.txt.
- Tests: new tests/e2e-wide-customer-107.js (1366/1280/1024, in run-all-look.sh); tests/fake-server.js made-up customers
  5550100 (Sample Customer, $42.50) and 5550101 (Zero Balance, $0.00); label checks in tests/e2e-120.js and tests/e2e-look.js
  now expect "Customer add" (was "Member Scan").

## Air Register (AIR POS look) 1.0.6 = AirMax 1.0.6 (built locally Oct 30 2026, NOT published)

Final check: see TEST-RESULTS.md (1.0.6 section).
- Coach's AirRegister 1.2.3.1 hotfix, ported as-is (AirMax look and keys kept):
  - Payment screen: "Back to sale (payments kept) (Esc)" when something is already paid (and no card is waiting). It closes the
    screen only; nothing is cancelled, voided or sent again. Esc does the same.
  - Red bar on the sale screen while a paid sale is not finished: "Paid $X: sale not finished." (+ "$Y still owed." when short)
    with "Back to payment (F12)" and "Check AIR POS again".
  - "Check AIR POS again" (bar and Payment screen) reads the sale from AIR POS again (new local route pay-recheck, login needed,
    one at a time) and finishes it here only if AIR POS already shows it Completed; otherwise it says what AIR POS reported.
  - Every time AIR POS refuses to finish a sale, one line with the reason goes to the app log.
  - Money recording is unchanged apart from the hotfix itself: no new totals, tax, tender or refund path. register.js gets ONLY
    the hotfix lines (tagged `hf1231`); tests/backend-frozen.test.js proves AirMax register.js minus the 1.0.5 lines = Coach's
    1.2.3.1 register.js byte for byte.
- Team Kit review (whole app) fixes, UI only:
  - History > Resume now asks "The current sale will be cleared. Resume the held order?" when the current sale has items (Held
    Orders > Resume already asked). Before, it cleared the current sale without asking.
  - Alt+letter key labels on blue/green/red window buttons (e.g. Customer > Find, New customer…, Payment > Check AIR POS again)
    were grey on blue/green and could not be read (contrast about 1.2-1.3:1); they now use the button's own text colour (3.7:1+).
    Labels and keys unchanged.
- Files: app/lib/register.js (hf1231 lines), app/server.js (pay-recheck route), app/public/app.js (buttons, Esc, bar, recheck,
  History Resume question), app/public/index.html (bar CSS + bar element in the scan bar, key label colour), app/update.json,
  pkg/Read Me.txt.
- Tests: new tests/e2e-stuck-106.js (hotfix, screenshots 1366 + 1024) and tests/e2e-teamkit-106.js, both in run-all-look.sh;
  tests/fake-server.js `/complete-refuse?n=` hook (AIR POS refuses to finish N times); tests/backend-frozen.test.js hotfix check;
  tests/total-check.test.js owed message = hotfix text.

## Air Register (AIR POS look) 1.0.5 = AirMax 1.0.5 (built locally Oct 29 2026, NOT published)

Final check (Oct 29 2026, 23:58 ET, on the final rebuilt code): `tests/run-all-look.sh all` 51 of 51 runs exit 0, 671 counted checks passed, 0 failed (incl. backend-frozen 17/17, settings-parity 10/10, bulkfolders-105 11/11, e2e-bulkfolders-105 23/23, e2e-final 18/18, e2e-totals-parity 9/9). Manual-style browser pass 13/13. Build 27/27, sha512 EF/+TWBI… matches.
- Bulk item FOLDERS in Quick Add (Ari's OK 10:46 PM ET; AirRegister alignment 10:49 PM ET). Same data shape, keys and limits as
  Coach's AirRegister plan (spec: /workspace/airpos-look-backups/bulk-folders-for-coach.md).
  - Today's bulk buttons stay where they are as single buttons at the top level (no "Main" folder). With no folders the box is
    exactly the 1.0.4 box (same buttons, order, grid, header, Alt keys).
  - Top level: up to 24 spots (folders + single buttons; single buttons stay at most 12 so an older version never cuts them).
    Up to 24 items per folder, one level only, folder names up to 20 letters and unique (ignoring case).
  - Folder button: white with the green sale stripe, light green tint, its name, "Folder · N items" and OPEN.
    Inside: "Back to folders" (gray stripe, Alt+Backspace), the folder name · N items, its items; the box header shows the folder
    ("Candy · Alt+1-5", or "Candy · Alt+1…=" for 10+ items; a long name shortens with "…").
  - Alt+1 … Alt+9, Alt+0, Alt+-, Alt+= press the first 12 VISIBLE spots (top level or open folder); spots 13-24 are tap-only and
    the box scrolls. Alt+Backspace = Back (not while typing in a text box; does nothing at the top).
  - The box goes back to the top after a finished sale, a new sale, Hold and Load Hold (any new sale id or resume).
  - Settings > Bulk items (Ctrl+5): tabs "Top level (n/24)" + one per folder; Add folder, Rename, Delete folder (asks first;
    its buttons move to the top level in its place, refused with "Move some items first" if there is no room); per row ↑/↓ and
    "Move to…"; products added by search or scan as before. Plain messages: "Top level is full: up to 24 spots…",
    "Folder Candy is full: up to 24 items", "There is already a folder called Candy".
  - Every Settings save of bulk items is checked AS A WHOLE (bulkItems + bulkFolders + bulkOrder): if any part is bad, nothing
    is saved (same rule as AirRegister).
- Stored data (settings.json on the PC): `bulkItems` unchanged (shape and 12 limit); NEW `bulkFolders`
  ([{ id: "f-…", name, items: [{ label, code, name, askPrice }] }]) and `bulkOrder` (["i:0", "f:f-…", …], the top-level order).
  No migration: an old file shows as before; an older version keeps the new keys in the file (settings load as {...defaults, ...file})
  and just shows the single buttons.
- No totals, price, tax, payment or Ask-price change: a folder item goes through the same addBulk path after the slot lookup.
  Every existing button, label and shortcut is unchanged; one new shortcut (Alt+Backspace, "Bulk items: back to folders").
- Files: app/lib/register.js (tagged `bf105` lines only), app/server.js (bulk-add passes the folder), app/public/side.js (box +
  editor), app/public/dlgkeys.js (key labels on the first 12 visible spots, Back label), app/public/index.html (CSS),
  app/shortcuts.json (Alt+Backspace).
- Tests: new tests/bulkfolders-105.test.js (unit) and tests/e2e-bulkfolders-105.js (in run-all-look.sh).
  tests/backend-frozen.test.js now checks register.js = store 1.2.3 + ONLY the tagged 1.0.5 bulk-folder lines;
  tests/settings-parity.test.js allows ONLY the tagged saveSettings lines, the Alt+Backspace shortcut and the two new (empty on a
  fresh install) keys; tests/keys-unique.test.js checks Alt+Backspace = bulk-back.
  tests/fake-server.js: new opt-in FAKE_HELD=1 (lists held orders and returns them with their lines) so the e2e does a REAL Load Hold;
  the e2e also checks the finished sale's total worked out by the fake server (FAKE_STRICT_COMPLETE=1) = the app total.

## Air Register (AIR POS look) 1.0.4 = AirMax 1.0.4 (built locally Oct 29 2026, NOT published)
- RustDesk remote help ID on screen (Ari's OK 10:02 PM ET; placement 10:03 PM ET). ID ONLY: the password is never asked for,
  read or shown (lib/remote.js was not changed and still never opens remote-access.txt).
  - Bottom status bar, right side, next to the version and clock: "Remote ID 123 456 789 · v1.0.4 · <date, time>".
    The version and clock stay; the right-hand items never shrink (the left ones do), so nothing is cut off at 1024x768 / 1280x720.
  - The "Reconnecting to Air Register…" screen (shown while Air Register is stuck / not answering) shows
    "Remote help ID: 123 456 789" in big type.
  - Read once after login through the existing remote-status call and kept in the page, so it stays on screen when Air Register
    stops answering; re-read every ~4 minutes (a failed read keeps the last ID and tries again in a minute).
  - RustDesk not set up on the PC: nothing is shown (same as 1.0.3).
  - AirMax still never installs, resets or changes RustDesk (managed by the regular Air Register); no new buttons.
- Files: app/public/app.js (ID read + show), app/public/index.html (one status bar span + CSS). No server, lib, settings, money,
  payment, refund, totals, button, label or shortcut change.
- New test tests/e2e-rdid-104.js (in run-all-look.sh) with tests/rdid-fake.js (faked RustDesk status; RustDesk cannot run on the
  Linux test box).

## Air Register (AIR POS look) 1.0.3 = AirMax 1.0.3 (built locally Oct 29 2026, NOT published)
- Includes everything from 1.0.2 (refund panel fit), which was never published: 1.0.3 is the next version to publish.
- "Color stripes" look (mock-up approved by Ari ~8:15 PM ET). Look only (one CSS block in index.html): no ids, keys, labels,
  data-a actions, server, lib, settings, payment, refund or totals logic changed.
  - Buttons are white with dark text and an 8px colour stripe on the left by group: green = sale, red = returns,
    blue = customer, orange = gift cards, gray = other. Remove Line is green, Log Out is gray.
  - Button icons are hidden (labels and every shortcut hint stay visible).
  - Return / Log Out text now starts at the same place as the other left buttons (it sat a few px further right).
  - Totals: one dark bar, the Total in the lighter AIR POS blue, bigger (34px).
  - Payment and refund panels: tender lines get the same stripes (Cash green, Gift Card orange, refund lines red);
    the Balance / Refund amounts sit in a dark strip (Balance in light blue, Refund in light red).
  - Scan box stays on top and is bigger: 50px tall with 21px text (46px / 20px on screens 740px tall or less), wider (up to 640px).
- New test tests/e2e-stripes-103.js (in run-all-look.sh) at 1366x768, 1280x720 and 1024x768. Older colour-only checks in
  e2e-look.js and e2e-120.js updated to the new look (see TEST-RESULTS.md).

## Air Register (AIR POS look) 1.0.2 = AirMax 1.0.2 (built locally Oct 29 2026, NOT published)
- Refund panel fit (Ari's OK 7:59 PM ET). Look only (CSS in index.html): no ids, keys, labels, server, payment or refund logic changed.
  - Refund lines are now the same height as the payment lines (they were ~83px; now 64px, 52px on short screens).
  - The Back / Pay and Back / Refund buttons are pinned to the bottom of the left panel: the list scrolls above them, so the
    cashier never has to scroll to reach Refund or Pay (1.0.1 needed scrolling at 1024x768, 1280x720 and 1366x768).
  - On screens 800px tall or less: lines and buttons 52px (never under 44px), smaller totals.
- Every button and every shortcut label stays exactly as in 1.0.1 (Ctrl+…, F1 = keys, (Esc), (Enter)); no hint hiding.
- New test tests/e2e-fit-102.js (in run-all-look.sh) at 1024x768, 1280x720, 1366x768 and 1280x800.

## Air Register (AIR POS look) 1.0.1 (built locally Oct 29 2026, NOT published)
- Brings in everything from store Air Register 1.2.3 (published Oct 29, 5:01 PM ET), the same as the store:
  payment panel on the left with the sale still visible and tappable, total check before completing, out-of-stock note and the stock
  check before the card, typed-amount gift card fix, Check only with a customer, Put on Account, Return to Account, refunds on the
  same left panel, Edit Customer + phone/duplicate fix, Gift Receipt key, Left/Right quantity, Put Aside/Load Aside removed,
  gift card balance on receipts, background printing + speed fix, print darkness, scan sounds, and the clickable version number
  with Update now (never during a sale or payment).
- New settings come with the store's defaults and in the store's place (Return to Account on, scan sounds on, print darkness normal).
- Update now / the version click use THIS app's own feed and guards only; the restart goes through this app's own launcher
  ("Air Register.vbs", data folder %LOCALAPPDATA%\AirRegisterAirposLook). The store feed and short link are still refused.
- The payment and refund panels get the AIR POS look (white header with a blue / red underline, blue Balance tile, outlined
  buttons, small corners). Colours and borders only: layout, sizes, keys and what each button does are the store's.

## Air Register (AIR POS look) 1.0.0 (first test build, published Oct 29 2026 to its own repo aklocalsolutions-create/arl-9530061a4d; download https://is.gd/airmax_dl)
- New, separate app built from store Air Register 1.2.1 + the 1.2.2 Up/Down arrow keys.
- Own identity: name, install/data folder, port 5157, mutex, autostart value, uninstall key, shortcuts, blue icon.
- Uninstall only removes its own Start-menu folder, desktop shortcut and autostart value; never Remote Help.
- Updates: ON, from this app's own installer-only repo only (https://github.com/aklocalsolutions-create/arl-9530061a4d/releases/latest/download/). Any other feed is refused; the store feed/short link are always refused, as is any installer not named AirRegister-AirposLook-Setup-*.
- Refuses to start while the store Air Register is open on the same PC.
- Main sale screen restyled like AIR POS 1.9.11 (white header, outlined left menu, small totals line). Look and layout only: no sale, payment, refund, tax, inventory or AIR POS API logic changed.

- Sale list columns use the store wording (Lookup Code, Name, Qty, Total; "Quantity" in the totals). Footer has only Member Scan, Items, Checkout (the extra Hold Order / Open Drawer buttons were removed; the left ones stay).

(Entries below are the store app's history.)

## 1.2.1-beta.1 (preview, not Latest)
### Customer screen: the store's own welcome message and logo
- Settings > Screens & Register Mode (manager only): a welcome message (up to 40 characters), a second line (up to 80; empty = shop name), Choose logo… (PNG or JPG, up to 500 KB and 2000 x 2000), Remove logo, and a live preview.
- Shown on the customer screen's Welcome only, also while signed out. Always plain text. Falls back to "Welcome" + shop name when empty, missing or broken.
- Kept on this PC (settings.json + customer-logo.png/jpg in the data folder). Nothing goes to AIR POS. No sale, payment, refund, tax, inventory, printing or updater code changed.

## 1.2.0 (not yet published; ships together with the payment/gift-card work, see HANDOFF-PAYMENT-GIFTCARDS.md)
### Printing and drawer
- Works with any printer:
  - Auto-picks the receipt printer, skipping virtual (PDF/XPS/OneNote/Fax) and offline printers, then falls back to the Windows default.
  - Re-detects when the saved printer is gone.
  - Printers that are not receipt printers print through their Windows (GDI) driver.
  - v4/XPS drivers get `XPS_PASS`.
  - A failed direct job is retried once through the driver.
  - The drawer opens through the same printer.
- The drawer waits at most 1–30 s (default 5), then the sale carries on with a short note. Pulse length is an advanced setting (standard default).
- Settings keeps the manual printer choice, Test print / Test drawer, and the new Save diagnostics file.
- Fixed the drawer not opening.

### Sale screen and keys (fewest keystrokes, no confirm popups)
- Scan adds at once. Enter on an empty scan box opens Payment. `*N` sets the quantity. Delete removes a line with no popup.
- F2 quick search panel. F5 Tax Off. F6 discount (also on the tiles). Ctrl+Shift+N new sale. Esc goes back one step.
- Top tiles: Customer first, then Items, then the rest. Bigger totals. Bulk items panel.
- Wrong barcode: an inline message plus a beep, with no popup. Items short on stock can be sold.
- After printing a receipt you go straight back to the sale screen.
- History: date presets (today … year, one date), a totals line and CSV export.
- Fixed the modal overlay staying over the screen.

### Payment and gift cards
- Full-screen payment:
  - Tender list: Credit Card, Cash, then the rest.
  - Enter moves down, + fills the remaining amount, and digits split the payment. Enter completes when nothing is due.
  - Quick cash buttons: Exact, next bills, and $5–$100.
  - The check number is asked for in place.
- Gift Card and Multiple Gift Cards on the right panel:
  - Type the amount once, then scan one card after another. Enter finishes.
  - Duplicates are refused. All the cards are paid in one checkout.
  - The cards are listed masked, and a masked slip prints.
- (Worker 2 may change this section during the merge.)
