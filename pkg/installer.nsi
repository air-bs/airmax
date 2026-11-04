; Air Max installer (NSIS 3.x, Unicode). Built by ../build.sh:  cd pkg && makensis -DVERSION=<v> -DNUMVER=<x.y.z> installer.nsi
;
; REWRITTEN Nov 3 2026: the original pkg/installer.nsi was never committed and was lost. This file was rebuilt from
; the PUBLIC 1.0.10 installer (instructions, strings, pages, file order, shortcuts, registry values and the uninstaller
; were read back out of the released .exe). See pkg/INSTALLER-NOTES.md for what is certain, what is guessed, and the
; Windows test checklist. tests/identity.test.js reads this file: keep the !define lines and the exact lines it checks.
;
; Per user, no admin (RequestExecutionLevel user). Everything of the app lives in $INSTDIR; the store's settings, logs,
; journal, parked sales and updates live in $LOCALAPPDATA\AirRegisterAirposLook, which the installer only ever creates
; and the uninstaller never touches.
Unicode true
!define APPID "AirRegisterAirposLook"
!define APPNAME "Air Max"
!define OLDNAME "Air Register (AIR POS look)"   ; name before the Oct 30 2026 rename: removed on upgrade (our shortcuts only)
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
!ifndef VERSION
  !error "pass -DVERSION=<x.y.z[-pre]> and -DNUMVER=<x.y.z> (build.sh does this)"
!endif
!ifndef NUMVER
  !error "pass -DNUMVER=<x.y.z> (build.sh does this)"
!endif

Name "${APPNAME}"
OutFile "out/${VERSION}/AirRegister-AirposLook-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPID}"
RequestExecutionLevel user
SetCompressor /SOLID lzma

VIProductVersion "${NUMVER}.0"
VIAddVersionKey "FileDescription" "${APPNAME} setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${APPNAME}"
VIAddVersionKey "ProductName" "${APPNAME}"

!include "MUI2.nsh"

; Pages: Welcome > Install > Finish ("Start Air Max now" ticked). No licence, no folder page (always the folder above).
; An update started by the app runs this with /S (silent): no pages, and Air Max is restarted by the launcher itself.
!define MUI_ICON "stage\AirRegister.ico"      ; installer icon = the app icon (the 1.0.10 exe carries the 6 images of this .ico)
!define MUI_UNICON "stage\AirRegister.ico"    ; same for the uninstaller (1.0.10's uninstaller icon data is the same size)
!define MUI_FINISHPAGE_RUN "$INSTDIR\Air Register.vbs"   ; only has to be defined: LaunchApp below does the start
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APPNAME} now"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function LaunchApp
  Exec `"$SYSDIR\wscript.exe" "$INSTDIR\Air Register.vbs"`
FunctionEnd

Section "Install"
  ; Only OUR node.exe (the one under $INSTDIR\node) is stopped, never another app's or the store Air Register's.
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $$_.ExecutablePath -like '$INSTDIR\node\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
  SetOutPath "$INSTDIR"
  ; app code is replaced as a whole so removed files do not linger; settings/data are NOT in here ($LOCALAPPDATA\${APPID})
  RMDir /r "$INSTDIR\app"
  File /r "stage/*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ; data folder: create it, and seed config.json from the shipped default ONLY if there is none (an existing one is never touched)
  CreateDirectory "$LOCALAPPDATA\${APPID}"
  IfFileExists "$LOCALAPPDATA\${APPID}\config.json" +2 0
    CopyFiles /SILENT "$INSTDIR\app\config.customer.json" "$LOCALAPPDATA\${APPID}\config.json"
  ; old name (before Oct 30 rename): remove OUR old shortcuts only, never the store "Air Register"
  Delete "$DESKTOP\${OLDNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${OLDNAME}"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\Air Register.vbs"' "$INSTDIR\AirRegister.ico"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\Air Register.vbs"' "$INSTDIR\AirRegister.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME} Settings.lnk" "$WINDIR\notepad.exe" '"$LOCALAPPDATA\${APPID}\config.json"'
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Read Me.lnk" "$INSTDIR\Read Me.txt"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "AK Local Solutions"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\AirRegister.ico"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd

; Uninstall removes the program folder, OUR shortcuts, OUR uninstall key and OUR autostart value. It never removes
; $LOCALAPPDATA\${APPID} (settings, logs, journal, parked sales), never the store Air Register, never Remote Help.
Section "Uninstall"
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $$_.ExecutablePath -like '$INSTDIR\node\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${OLDNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${OLDNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPID}"
SectionEnd
