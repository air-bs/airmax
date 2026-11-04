# Receipt printers and cash drawer (no AIR POS needed)

Settings > Printer & cash drawer:
- **Connection**: Windows printer (USB, any installed queue) / Network (IP, port 9100) / COM port (this list includes the Epson TM Virtual Port).
- **Receipt printer**: installed Windows printers by name, each with its detected type and any problem ("set to offline", "out of paper").
- **Printer type**: Auto (picked from the queue name, driver and port) / Epson / Generic ESC/POS / Star.
- **Generic options** (Generic ESC/POS only): characters per line 48/42/32, cutter on/off, code page, picture command (GS v 0 or ESC *).
- **Cash drawer**: drawer 1 (pin 2) or drawer 2 (pin 5).
- **Print receipts**: Automatic (default: receipt printers get direct receipt commands, any other printer prints through its Windows driver), Direct, or Windows driver.
- **Print test page** and **Test drawer** buttons.

| Printer | What gets sent |
|---|---|
| Epson TM-T20II ("M267D") | ESC @, ESC t, receipt as a GS v 0 picture (576 dots, 256-row bands), GS V 66 3 partial cut. Drawer: ESC p 0 128 128 |
| Generic ESC/POS ("M804", POS-80, Xprinter) | ESC @, FS . (leaves Chinese mode), ESC t <code page>, GS v 0 in 64-row bands (or ESC * 33), GS V 66 3 or feed. Drawer: ESC p 0/1 128 128 |
| Star TSP100 / TSP143 | Star raster only: ESC * r R/A, ESC * r P 0, ESC * r E 13, rows `b n1 n2 …`, ESC FF EOT, ESC * r B. Test page and notes go as a picture too. Drawer: BEL (drawer 1) or SUB (drawer 2) |

The receipt is the same PDF AIR POS prints. The helper (hw/AirRegisterHw.exe, `renderMono`) turns it into a 1-bit picture
at the printer's width, and Air Register sends the bytes RAW through the Windows spooler.
- Before sending, the helper refuses when the queue is set to "Use Printer Offline" or paused.
- After sending, it watches the job for up to 8 s (25 s while the printer is still printing). If the job errors, goes
  offline, runs out of paper or is still waiting, it is cancelled, so a receipt or drawer kick does not come out minutes
  later, and a plain error is shown.
- A failed receipt never undoes the sale. The done screen shows the error and **Print Receipt (P)** reprints it.
- 1.2.0 — works with any printer:
  - **Auto-pick**: with no printer chosen (or the chosen one no longer installed) Air Register picks the receipt printer itself — Epson/Star/POS-80/thermal names, drivers and ESDPRT/TMUSB ports first — skipping virtual printers (PDF, XPS, OneNote, Fax) and offline ones, then the Windows default printer.
  - **Automatic method**: receipt printers get RAW bytes; anything else (office/inkjet/laser/unknown) prints the receipt PDF through its Windows (GDI) driver. The helper sends RAW jobs with datatype `RAW`, or `XPS_PASS` first on v4/XPS-class drivers (falling back to the other if refused). If the direct job still fails, the receipt is retried once through the driver; offline/out-of-paper errors are not retried.
  - **Drawer** kicks go to the same printer. The register waits at most the drawer wait (Settings, 1–30 s, default 5) and then carries on with a short note. Pulse length is under Advanced (standard 50 ms default).
  - **Save diagnostics** (Settings) writes `AirRegister-printer-diagnostics.txt` on the Desktop: app and helper version, helper ping (.NET 4.8 hint if it fails), CLR, Windows default, every printer with driver/port/receipt/virtual/default, the chosen printer and method, and the recent printer log (`printer-diag.log`). No passwords or card data.
  - Needs the bundled helper (`hw/AirRegisterHw.exe`, .NET Framework 4.8, built into Windows 10/11). If the helper is missing, Air Register falls back to the AIR POS hardware service.

Tests: `node tests/printcmd.test.js` (byte level) and `node tests/printing.test.js` (flow with a fake helper).
