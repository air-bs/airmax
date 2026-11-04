# Cash drawer: why it opens on one PC and not the other

The drawer is plugged into the receipt printer. Air Max opens it by sending the printer a small "kick" signal. Which signal, and how
it gets there, depends on settings that are kept **on each PC separately**. So two PCs with the same Star TSP143 can behave
differently. Do the checks below on **both** PCs and write the answers side by side. The first one that differs is usually the cause.

## 1. Read the DRAWER line (2 minutes, tells you most of it)
1. On the PC that does NOT open: press **Ctrl+D** once.
2. Open **Settings (Ctrl+,)** > **Export log** and open the file. Near the end there is one line starting with `DRAWER [Ctrl+D / Open Drawer]`.
3. Do the same on the PC that works, and compare the two lines. Each line says:
   - **printer** and how it is connected: `Windows printer port USB001` (USB), a `COM port ... (serial / Bluetooth)`, or `network ip:port`,
     plus the Windows **driver** name;
   - **type**: `Star (StarLine)`, `Epson ESC/POS` or `Generic ESC/POS`, and whether it was guessed (`Automatic`) or `set in Settings`;
   - **tried**: every way Air Max tried, in order, and what came back (`ok` or `FAILED: <reason>`);
   - **result**: `drawer signal sent`, `FAILED`, `NO ANSWER in 5 s`, or `not sent: ...` (refused before anything was sent).

What the common answers mean:
| In the line | Meaning | What to do |
|---|---|---|
| `not sent: Your user is not allowed to open the drawer without a sale` | Logged in as a cashier; only an AIR POS manager may open the drawer with no sale. | Log in as a manager, or turn on the AIR POS setting that asks for a password to open the cash box (then Air Max asks for it too). It works after a cash sale for everyone. |
| `type Generic ESC/POS` (or `Epson`) on a **Star** | Air Max sent the ESC/POS kick (`ESC p`), which a Star in StarLine mode ignores. | Settings > Printer & Drawer: **Printer type = Star (TSP100 / TSP143)**. |
| `COM port ... (serial / Bluetooth)` or `network ...` with `Automatic` | With no Windows driver to look at, Automatic picks Generic ESC/POS. | Set **Printer type = Star (TSP100 / TSP143)** on that PC. |
| `direct kick ... FAILED: ... reports an error` then `Windows driver drawer character ... ok` | Normal for the Star futurePRNT queue: it refuses direct jobs, so Air Max uses the driver. | Nothing (the next Ctrl+D goes straight to the driver). |
| `Windows driver drawer character ... FAILED: unknown command` | The Air Max helper on this PC is older than the drawer-through-driver step. | Install the current Air Max on this PC. |
| `... no Star "Control" font` | The queue is not the Star futurePRNT driver. | Use the plain Star queue (driver "Star TSP100 Cutter (TSP143)"), not a copy. |
| `... Text Only` | The queue is a "(Copy N)" set up as Generic / Text Only. | Pick the plain Star queue in **Receipt printer**. |
| `AIR POS hardware service ... FAILED: ... not reachable` | No built-in helper on this PC, and the old AIR POS service is not running either. | Install Air Max fully, or set **Printing engine = Built-in only** and check the helper. |
| `NO ANSWER in 5 s` | The printer did not take the job in time (off, no paper, cable, paused queue). | Check the printer; look for a later `after the wait:` line for what it finally answered. |

## 2. Compare the Air Max settings (Settings > Printer & Drawer, Ctrl+1)
Write down on both PCs: **Connection**, **Receipt printer**, **Printer type**, **Print receipts** (print method), **Printing engine**,
**Cash drawer** (Drawer 1 pin 2 / Drawer 2 pin 5), **Drawer kick pulse**, **Drawer wait (seconds)**, **Open drawer after a sale**.
- **Receipt printer** must be the plain Star queue (driver "Star TSP100 Cutter (TSP143)"), not a "(Copy N)" or Generic / Text Only queue.
- **Cash drawer** must match the drawer socket the cable uses (almost always Drawer 1, pin 2).
- **Open drawer after a sale** only affects the automatic opening after a sale, not Ctrl+D.
- **Open drawer (test)** in Check printers sends exactly what Ctrl+D sends: use it to test after each change.

## 3. Compare how the printer is connected (Windows)
- USB, Bluetooth or network? A TSP143IIIBI can be paired over Bluetooth on one PC and plugged in by USB on another. Bluetooth shows as a
  COM port (Settings > Connection = COM port), which needs **Printer type = Star** (see the table).
- Windows Settings > Printers: same queue name and the same driver (Star TSP100 futurePRNT) on both PCs? Not paused, not "Use printer offline"?
- Same Star printer mode: StarLine on both (Star's "TSP100 Configuration" / futurePRNT Configuration > emulation). An ESC/POS-mode
  printer needs Printer type = Generic ESC/POS instead.

## 4. Compare the Star driver's own "open drawer" setting
Windows > Printers > the Star queue > **Printer properties > Device Settings > Peripheral Unit Type**.
- `Cash Drawer` makes the **driver itself** open the drawer at the end of **every printed document**, whatever Air Max sends. This was set on
  some registers as a stop-gap. A PC with it ON opens the drawer after every receipt (and Air Max's own Ctrl+D job also triggers it);
  a PC with `No Use` relies on Air Max's kick only.
- If the two PCs differ here, that alone explains "works here, not there". Air Max's own kick is meant to work with `No Use` (not yet
  confirmed on a real TSP143); the DRAWER line on that PC (step 1) then tells you which part fails. (Changing this setting is the store's call; see store problem #8.)

## 5. Still different?
- Same Windows user? The helper prints as the logged-in Windows user; a different user can have a different default printer and queue rights.
- Same Air Max version on both PCs (version in the bottom bar)?
- Send both DRAWER lines (and Settings > Printer & Drawer > **Save diagnostics**) to support. They contain printer names and error texts only,
  no customer or sale data.
