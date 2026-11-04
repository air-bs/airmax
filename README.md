# Air Register (AIR POS look) 1.0.0

**Separate app** from the store Air Register (1.2.x). Same register engine (copied from 1.2.1 + the 1.2.2 arrow keys), with the main sale screen restyled to look like AIR POS 1.9.11. It can be installed on the same PC as the store app without touching it:

| | Store Air Register | This app |
|---|---|---|
| Install folder | `%LOCALAPPDATA%\Programs\AirRegisterStandalone` | `%LOCALAPPDATA%\Programs\AirRegisterAirposLook` |
| Data / settings | `%LOCALAPPDATA%\AirRegisterStandalone` | `%LOCALAPPDATA%\AirRegisterAirposLook` |
| Local port | 5057 | **5157** |
| Launcher mutex | `Local\AirRegisterStandaloneLauncher` | `Local\AirRegisterAirposLookLauncher` |
| Autostart (Run) value | `AirRegister` | `AirRegisterAirposLook` |
| Uninstall key | `...\Uninstall\AirRegisterStandalone` | `...\Uninstall\AirRegisterAirposLook` |
| Shortcuts | `Air Register.lnk`, Start menu "Air Register" | `Air Register (AIR POS look).lnk`, Start menu "Air Register (AIR POS look)" |
| Installer | `AirRegister-Standalone-Setup-<v>.exe` | `AirRegister-AirposLook-Setup-<v>.exe` |
| Update feed | store feed | placeholder (off) until this app gets its OWN feed; the store feed and is.gd/airbiz_dl are refused in code |
| Remote Help (RustDesk) | installs / removes it | never installs or removes it |

Only one of the two can be open at a time: this launcher refuses to start while the store app runs (its mutex or port 5057). Both sign in as the same AIR POS station (shared `%ProgramData%\AirPos\device_id.txt`, deliberately unchanged).

---
(Below: the original store README, kept for the engine details. Names/paths in it refer to the store app.)

# (store) Air Register (standalone) 1.2.0

A keyboard-first register built for minimum keystrokes. It talks to the AIR POS cloud APIs **directly**, so no AIR POS window is needed. It signs in with any AIR POS company, user and password, just like AIR POS.

Installer: `pkg/out/<version>/AirRegister-Standalone-Setup-<version>.exe`. It installs per user with no admin rights, to `%LOCALAPPDATA%\Programs\AirRegisterStandalone`. Test results are in `TEST-RESULTS.md`.

## How it works
- `app/server.js` is a small Node server on **127.0.0.1:5057** only. It uses the bundled node.exe. It serves the UI and refuses requests from other web origins.
- `app/lib/airpos.js` sends exactly what AIR POS 1.9.11 sends:
  - the same endpoints
  - the same headers (`ide`, `lang`, `service`, `shop`, `operator`, `offset_hours`, `stationid`, `deviceid`, `olddeviceid`, `devicename`, `appversion 1.9.11`)
  - the same form or JSON bodies
  - the same device and station ids, read from the AIR POS hardware service (`/deviceInfo`) the way AIR POS does
- Login is deviceInfo → Login → Home/Index → SessionCheck. Logout is local, as in AIR POS.
- Payment is AuthorizationCheck → Save (pending) → ReceiveBegin → Complete.
- Receipts use BillContentGet → local PrintBillContent, with the same template and field dialog as AIR POS. The cash drawer uses local OpenCashbox.
- `app/lib/register.js` holds the cart and register state. Totals use AIR POS's own client rounding.
- The UI is `app/public/` (index.html, app.js, shortcut-core.js, keys in `app/shortcuts.json`). The launcher opens it as an Edge `--app` window with its own profile.
- **Credentials:** the password is typed every time and never stored. The session token lives only in server memory. Logs record only the endpoint and status, never passwords or tokens. The login screen remembers only the last company and username.
- **Launcher** (`Air Register.vbs` → `AirRegister.ps1`):
  1. If localhost:20001 is not running, it starts the AIR POS hardware service from the installed AIR POS (`%LOCALAPPDATA%\AirPos\app-*\resources\app\Pfa.Retail.Terminal.Console\`). It does not open AIR POS.
  2. It starts the server and opens the window.
  3. When the window is closed, it stops the server. It stops the hardware service only if the launcher started it and AIR POS is not running.

## Keys
Built for the fewest keystrokes and no "are you sure?" popups in the sale flow.
- Scan adds the item at once. **Enter** on an empty scan box opens Payment. `*5` (or `5*`) + Enter sets the quantity of the selected line. **Delete** removes the line (no popup). + / − change quantity.
- Payment: the cursor starts on **Credit Card**; **Enter** moves down the list, **+** fills the rest of the amount on the highlighted line, digits type a custom amount (split payment), and when nothing is left due **Enter** completes. Cash sale = **Enter, +, Enter**. Under Cash: Exact / next bills / $5–$100 buttons.
- Gift cards: right panel **Gift Card** (Ctrl+G, one card) and **Multiple Gift Cards** (Ctrl+Shift+G: type the amount once, scan, scan, … Enter on an empty box finishes).
- F2 Quick search · F3 Customer · F4 Item discount · **F5 Tax Off** · **F6 Discount** · F12 / Ctrl+C Payment · Ctrl+Shift+N New sale · Ctrl+D Drawer · Ctrl+P Reprint · Ctrl+H Hold · Ctrl+Shift+H Load hold · Ctrl+R Return (no receipt) · Ctrl+L History · Ctrl+F Search · Shift+F3 Clear customer · Ctrl+Shift+B Gift card balance · Ctrl+Shift+D Hardware check · Ctrl+Shift+U Log out · Esc one step back · F1 all keys.
- Every action button shows its key. One key = one action, everywhere: `tests/keys-unique.test.js` runs first in `build.sh` and stops the build on any duplicate or wrong key label.
- **Return without a receipt:** Ctrl+R (or **Return** on the right panel) turns return scanning on; scanned items go in as red negative lines at today's price (tax refunded per the *Refund tax on returns without a receipt* setting). Ctrl+R again goes back to selling, so returns and sale items can be mixed. Enter: if money goes back, the Refund screen shows Cash (default) and **Card — refund on card machine** (the cashier refunds the card on the card machine; Air Register records it in AIR POS), Enter refunds; if the customer still owes, the normal payment screen shows the net. No confirms. Recorded on AIR POS as a non-order return (`/ReturnOrders/NonOrderReturnOrderCreate`). Return with a receipt is unchanged (History → Take Return).
- Clicking or tapping outside a popup closes it (same as Esc). The full-screen payment screen has no outside.
- The side panels are resizable: drag their inner edge (double-click = default width; remembered on this PC). Buttons reflow: one column when narrow, 2, 3 or more when wide.
- Ctrl+W and Ctrl+Shift+R are blocked; F5 never reloads.

## Supported (phase 1)
- Login and logout; clock in and clock out
- Scan and search
- Cart with promotion recalculation; quantity changes and line removal; order discount
- Hold and resume
- Cash payment with change
- Receipt print and reprint (default template, no options)
- Cash drawer
- Return with receipt; return without a receipt (Ctrl+R, mixable with a sale)
- History

## New in 1.2.0
- Printing works with any printer: the receipt printer is found and picked automatically (virtual and offline printers are skipped, then the Windows default); a saved printer that disappeared is re-detected; printers that don't take receipt commands print through their Windows driver; the drawer opens through that same printer. Settings still lets you choose by hand, with Test print / Test drawer and a diagnostics file.
- Drawer: gives up after the drawer wait (Settings, 1–30 s, default 5) with a short note, so the sale never hangs; pulse timing is an advanced setting (standard values by default). Fixed the drawer not opening on some PCs.
- Full-screen payment: tender list (Credit Card, Cash, then the rest), large Due / Tendered / Change, split payments, check number asked in place. Sizes are CSS variables in index.html; `PAY_ENTER_COMPLETES` in app.js turns "Enter completes at $0" on or off.
- Gift cards: one card or many in one checkout (same amount typed once, every scan adds, duplicates refused, masked list with amounts, printed gift-card slip with masked numbers).
- Quick search panel (F2) and bulk items panel; bigger totals.
- Top row has only three tiles: Customers, Items, Payment. Discount (F6), Tax Off (F5) and History (Ctrl+L) are on their keys and in the side panels (Sale Discount / Tax Off on the right, History on the left).
- Reprint (History, customer purchases, Ctrl+P, P on the sale-done screen) is one action: it prints the store's default receipt to the default/auto-picked printer with nothing shown on screen. Only a failed print shows a short error.
- Wrong barcode: a short message under the scan box and a beep (no popup). Items short on stock can still be sold.
- After printing a receipt you are back on the sale screen. History has date presets (today, yesterday, this/last week, this/last month, 30/90 days, quarter, year, one date), a totals line and CSV export.
- Removed confirm popups for Delete, New sale and removing a parked sale.

## New in 1.1.0
- Payments: cash (quick bills + next-bill suggestions), card terminal, keyed card (Stripe Elements iframe only: Air Register never reads, logs or stores card data), gift card, check, store credit, split.
- Customers (F3, wording is "customer" everywhere): search by name / phone / e-mail / number, add, edit, attach / remove, past purchases and returns from them.
- Gift cards (Ctrl+G): balance, sell / activate, reload.
- Open Drawer button (one click) + local drawer log in End of Day; Ctrl+K lets you choose Pay In or Pay Out.
- Price check with stock, Put Aside / Load Aside (this PC), sale note (local, printed in every printer mode), calculator, find in sale, zoom, status bar.
- Low-stock warning before payment (AIR POS refuses "Insufficient inventory" sales); no-receipt returns refund the sales tax by default (setting "No-receipt returns").
- The left "Load" button is now "History" (Ctrl+L).

## Still done in AIR POS back office
Products, prices and stock, staff, store settings, card-reader setup, customer points / credit limits. No-receipt returns refund cash, or card on the card machine (recorded in AIR POS by Air Register).

## Card refund check (returns with a receipt)
After a receipt return that goes back to a card, Air Register asks AIR POS (`/ReturnOrders/RetailReturnOrderGet`) whether the card refund finished. **Refunded $X to card** shows only when AIR POS says Completed; otherwise **Card refund NOT finished — don't give cash** shows with **Retry card refund**, which re-checks first and then asks AIR POS to retry the SAME return (`/ReturnOrders/RetailReturnOrderRetry`, only while AIR POS shows it Pending, like Refund Management). It never creates a new return. Waiting card refunds are saved in `journal/card-refunds.json` and re-checked after a restart or crash.

## Requirements
- Windows 10 or 11 with Microsoft Edge, and an internet connection.
- A receipt printer installed in Windows with the cash drawer cabled to it. Air Register prints and opens the drawer with its own built-in helper; **AIR POS does not need to be installed**. If the AIR POS hardware service is installed, it is used as a fallback (Printer & Drawer settings, Ctrl+,: Auto / Built-in only / AIR POS service only).

## Settings
`%LOCALAPPDATA%\AirRegisterStandalone\config.json` (Start menu > Air Register > Air Register Settings). Upgrades never overwrite it.
- `port` (default 5057)
- `blockedCompanies`: the **customer installer ships with `[]`**, so any company can log in. The box dev/test config (`app/config.dev.json`) sets a made-up `["blocked-demo-co"]` and shows a red "DEV BUILD" pill. Real company names that a dev/test box must never sign in to are NOT kept in the repo: set the environment variable `AIRMAX_BLOCKED_COMPANIES="name one,name two"` (comma separated) when starting the dev server; they are added to this list. `build.sh` refuses to package a config with blocked companies.
- `updateFeedUrl` (optional): overrides the update folder that ships in `app/update.json`.

## Updates (your own website, generic HTTPS)
- Feed: `app/update.json` → `"updateFeedUrl": "https://YOUR-DOMAIN/air-register/updates/"`. **This is a placeholder.** While it says YOUR-DOMAIN, update checks are off. Put your domain in it and run a build, so every install after that knows where to look. Only `https://` URLs are accepted.
- The app checks `latest.yml` about 20 seconds after start and then every 6 hours. If the version is newer, it downloads the Setup .exe and checks its **size and sha512** against latest.yml. A file that does not match is rejected.
- The top bar then shows "update x.y.z ready". When the register window is closed (or at the next start), the launcher checks the sha512 again, runs the installer silently (`/S`) and reopens. Nothing installs in the middle of a sale. Settings are kept.

### How to push an update
1. Raise the version and build on a machine with makensis: `./build.sh 1.0.1`
2. Open `pkg/out/1.0.1/`. It contains:
   - `latest.yml`
   - `AirRegister-Standalone-Setup-1.0.1.exe`
   - `AirRegister-Standalone-Setup-1.0.1.exe.blockmap`
3. **Upload `latest.yml`, the new Setup .exe and its .blockmap to `https://<your-domain>/air-register/updates/`**, using your host's file manager or FTP. Upload the .exe and .blockmap first and `latest.yml` last, overwriting the old latest.yml.
4. Check that `https://<your-domain>/air-register/updates/latest.yml` opens in a browser. Registers pick the update up within 6 hours and install it the next time they are closed or opened.

Security note: the installer is not code-signed. Anyone who can write to that web folder can push code to the registers. Keep the hosting/FTP password strong, and consider code signing later.

## Known notes
- Logging in here does not log out AIR POS on the same PC: the server allows concurrent sessions. Clock in and clock out are per **station**, though, so clocking out here also ends AIR POS's register session on that PC.
- On the build box (Linux and wine, no printer), PrintBillContent crashed the wine-hosted hardware service. This is a wine/X problem, not seen as an app error. It still needs checking with a real printer on Windows.
- AIR POS computes the due amount on the client (for example $2.84). Its order list can show 1 cent less ($2.83). Air Register matches AIR POS's checkout amount.

## Layout of this folder
- `app/`: the app (dev `config.json` and `config.dev.json` are **not** packaged)
- `pkg/stage/`: installer contents (launcher, node.exe, icon, Read Me)
- `pkg/installer.nsi`
- `build.sh`
- `tools/app-builder`: makes the blockmap
- `tests/`: e2e.js, keycheck.js, absent-local.js and probes. The test password comes only from the env var `AIRMAX_TEST_PW`.
- `screens/`
