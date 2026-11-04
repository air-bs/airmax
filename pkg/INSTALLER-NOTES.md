# pkg/installer.nsi - rebuilt Nov 3 2026

The original `pkg/installer.nsi` was never committed and was lost. This one was rebuilt from the PUBLIC
`AirRegister-AirposLook-Setup-1.0.10.exe`: its NSIS header (instructions, string table, pages) was decompressed and
disassembled, the exe was 7z-listed, and its PE resources (icons, dialogs, manifest, version info) were extracted.
Built with NSIS 3.11 (Debian `nsis` 3.11-1, extracted without root; run with `NSISDIR=<usr/share/nsis>`).
`build.sh` calls `cd pkg && makensis -DVERSION=<v> -DNUMVER=<x.y.z> installer.nsi` and is unchanged.

To build, `pkg/stage/node/{node.exe,LICENSE}` must exist (gitignored). Take them from a released installer:
`7z x AirRegister-AirposLook-Setup-1.0.10.exe 'node/*'` (node.exe sha256 d702daa8...f8e9, LICENSE ed34dd8e...b8e9).

## Matched for CERTAIN (read back out of the 1.0.10 exe; the new build's disassembly is the same instruction for instruction)
- Same 481 instructions in the installer, 79 in the uninstaller. Normalised diff vs 1.0.10 = only: the two files that are
  new in the candidate (`app/labellayouts.js`, `app/public/printlabels.js`), DisplayVersion, and jump-target numbers.
  The uninstaller disassembly is identical.
- NSIS 3 Unicode, SOLID lzma, per-user (`RequestExecutionLevel user`), OutFile `AirRegister-AirposLook-Setup-<v>.exe`.
- InstallDir `$LOCALAPPDATA\Programs\AirRegisterAirposLook`; data dir `$LOCALAPPDATA\AirRegisterAirposLook`.
- Pages: Welcome, InstFiles, Finish (with a "Start Air Max now" checkbox that runs `wscript.exe "$INSTDIR\Air Register.vbs"`);
  uninstall: Confirm, InstFiles. English. No licence page, no folder page. `/S` silent works (no pages).
- Installer icon and uninstaller icon = `stage\AirRegister.ico` (icon resources are byte-identical to 1.0.10, the PE stub is
  the same size, the uninstaller's `Uninstall.exe` is the same size, 135,871 bytes).
- Version resource: FileDescription "Air Max setup", ProductName/LegalCopyright "Air Max", FileVersion=VERSION, VIProductVersion NUMVER.0.
- Install steps in order: nsExec PowerShell kills only node.exe under `$INSTDIR\node`; SetOutPath; `RMDir /r $INSTDIR\app`;
  File /r stage; WriteUninstaller; create data dir; copy `config.customer.json` to `config.json` only if there is no config.json;
  delete old-name (`Air Register (AIR POS look)`) desktop shortcut and Start-menu folder; create the desktop shortcut, the
  Start-menu folder (Air Max, Air Max Settings = notepad on config.json, Read Me, Uninstall Air Max); registry.
- Registry, `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AirRegisterAirposLook`: DisplayName "Air Max", DisplayVersion,
  Publisher "AK Local Solutions", DisplayIcon, InstallLocation, UninstallString (quoted), NoModify=1, NoRepair=1.
- Uninstall: same node kill, delete OUR desktop shortcut and Start-menu folder (and the old-name ones), `RMDir /r $INSTDIR`,
  delete our uninstall key and our Run value `AirRegisterAirposLook`. Never touches `$LOCALAPPDATA\AirRegisterAirposLook`.
- Installed file list and paths are the same as 1.0.10 (22 files + `app/` tree), sizes differ only for changed source files.

## GUESSED / could not be recovered
- Comments, macro/section layout and the define names (a compiled exe keeps none of them). The order of defines does not matter.
- Section names ("Install"/"Uninstall") are not kept in the exe as far as I could tell.
- `MUI_FINISHPAGE_RUN` value is only a placeholder (the original used a run function: its code is matched, its name is not).
- `File /r "stage/*.*"` is the form I chose; the exe stores only the resulting file list. Per-file overwrite/date flags
  are the NSIS defaults; the disassembly of the 22 File instructions shows no difference to 1.0.10.
- Whether the original also had `SetCompress`/`SetDatablockOptimize`/`CRCCheck` lines: none are needed to reproduce the same header (same size
  apart from the 2 new files and the longer version string), so none were added.
- Nothing here was run on Windows. Printer helper / real-printer behaviour was not tested.

## Windows test checklist (use the TEST build `1.0.11-test.1`, on a test PC or VM, NOT a live store)
1. Fresh install (no previous Air Max): runs without admin prompt; pages Welcome, Install, Finish; Finish "Start Air Max now" ticked.
   Folder `%LOCALAPPDATA%\Programs\AirRegisterAirposLook` has Air Register.vbs, AirRegister.ico/.ps1, RegisterLock.ps1, Read Me.txt,
   Uninstall.exe, node\node.exe, app\ ...; `%LOCALAPPDATA%\AirRegisterAirposLook\config.json` created.
2. Shortcuts: desktop "Air Max", Start menu "Air Max" folder (Air Max, Air Max Settings, Read Me, Uninstall Air Max); icons are the blue Air Max icon;
   Air Max starts from the desktop shortcut, window title "Air Max", port 5157.
3. Programs & Features (per user) shows "Air Max", version 1.0.11-test.1, publisher AK Local Solutions, icon.
4. Upgrade over 1.0.10: install 1.0.10 first, change a setting in config.json and park a sale, install the test build over it:
   settings and parked/pending sales still there, config.json not replaced, old-name shortcuts gone, app replaced (no old files in app\).
5. Silent: `AirRegister-AirposLook-Setup-1.0.11-test.1.exe /S` over 1.0.10: no windows, installs, no admin prompt.
6. Auto-update from 1.0.10: needs a feed hosting the test exe + latest.yml (a LOCAL/test feed only, never the live feed); 1.0.10 finds, downloads,
   checks sha512, runs the installer `/S`, Air Max comes back by itself.
7. Uninstall (shortcut or Programs & Features): program folder, shortcuts, uninstall key and autostart value are gone;
   `%LOCALAPPDATA%\AirRegisterAirposLook` (settings, logs, journal, parked sales) is still there; the store "Air Register" is untouched.
8. Reinstall after uninstall: old settings and parked sales picked up.
9. Printer helper: run the helper (`hw` exe from the install) with a real receipt printer and cash drawer: print a test receipt, open the drawer.
