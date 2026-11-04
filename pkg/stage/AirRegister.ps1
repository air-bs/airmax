# Air Register (AIR POS look) launcher, run hidden from "Air Register.vbs".
# Separate app from the store Air Register: own install folder, data folder (%LOCALAPPDATA%\AirRegisterAirposLook),
# port (5157), mutex, autostart value and update feed. It refuses to start while the store Air Register is running.
# 1) checks the built-in printer/drawer helper (app\hw\AirRegisterHw.exe). AIR POS is NOT needed:
#    printing and the cash drawer go through the helper. Only if Settings > Printer & drawer is set to
#    "AIR POS service only" (settings.json "hardware": "airpos") does it start the old AIR POS hardware service (localhost:20001) as before,
# 2) starts the Air Register server (bundled Node, 127.0.0.1 only, hidden),
# 3) opens the Air Register window (Edge app mode, own profile),
# 4) when the window closes, stops the server (the helper exits with it; a legacy service we started stops too),
# 5) installs a downloaded, sha512-verified update (from the GitHub release feed) silently.
# 1.2: customer display on a second monitor (read-only page /customer in its own Edge window), see Sync-Customer.
# 1.1: watchdog (server restarted if it stops), Full screen (Edge kiosk) and Register Mode (start with Windows, window reopens
#      if closed, keyboard lock + hidden taskbar via RegisterLock.ps1; exit only through Air Register's manager login, which
#      writes control.json {action:'exit'}). Remote help (RustDesk) is never stopped, hidden or blocked by any of this.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = 'Air Max'
$Data   = Join-Path $env:LOCALAPPDATA 'AirRegisterAirposLook'
$LogDir = Join-Path $Data 'logs'
$Config = Join-Path $Data 'config.json'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if (-not (Test-Path $Config)) { Copy-Item (Join-Path $Root 'app\config.customer.json') $Config }
$cfg = Get-Content $Config -Raw | ConvertFrom-Json
$uiPort = if ($cfg.port) { [int]$cfg.port } else { 5157 }
$Log = Join-Path $LogDir 'launcher.log'
function Say($m) { Add-Content -Path $Log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) }
function Fail($m) { Say "ERROR: $m"; [System.Windows.Forms.MessageBox]::Show($m, $AppName, 'OK', 'Error') | Out-Null; exit 1 }
function Up($url) { try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 | Out-Null; $true } catch { $false } }
function Store-AppRunning { # store-app-detect: its launcher mutex, or its server answering on its port
  $m = $null; if ([System.Threading.Mutex]::TryOpenExisting('Local\AirRegisterStandaloneLauncher', [ref]$m)) { $m.Dispose(); return $true } # store-app-detect
  return (PortOpen 5057) # store-app-detect
}
function PortOpen($port) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $port); $c.Close(); $true } catch { $false } }

$mutex = New-Object System.Threading.Mutex($false, 'Local\AirRegisterAirposLookLauncher')
$first = $mutex.WaitOne(0)
$uiUrl = "http://127.0.0.1:$uiPort/"
$server = $null; $hw = $null

function Find-HardwareService {
  if ($cfg.hardwareServiceExe -and (Test-Path $cfg.hardwareServiceExe)) { return $cfg.hardwareServiceExe }
  $base = Join-Path $env:LOCALAPPDATA 'AirPos'
  $apps = Get-ChildItem -Path $base -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
          Sort-Object { try { [version]($_.Name -replace '^app-','') } catch { [version]'0.0' } } -Descending
  foreach ($a in $apps) {
    $e = Join-Path $a.FullName 'resources\app\Pfa.Retail.Terminal.Console\Pfa.Retail.Terminal.Console.exe'
    if (Test-Path $e) { return $e }
  }
  return $null
}
function Find-Edge {
  if ($cfg.edgeExe -and (Test-Path $cfg.edgeExe)) { return $cfg.edgeExe }
  foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe') {
    try { $p = (Get-ItemProperty $k -ErrorAction Stop).'(default)'; if ($p -and (Test-Path $p)) { return $p } } catch {}
  }
  foreach ($p in "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

function Start-Server {
  if (Up "$($uiUrl)api/state") { return $true }
  $env:AIRREG_CONFIG = $Config
  $env:AIRREG_DATA = $Data
  $node = Join-Path $Root 'node\node.exe'
  Say 'starting server'
  $script:server = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory (Join-Path $Root 'app') -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $LogDir 'server.log') -RedirectStandardError (Join-Path $LogDir "server-errors.log")
  $t = 0; while (-not (Up "$($uiUrl)api/state") -and $t -lt 20) { Start-Sleep 1; $t++ }
  if (Up "$($uiUrl)api/state") { return $true }
  try { $script:server | Stop-Process -Force } catch {}; return $false
}
function Read-Settings { $sf = Join-Path $Data 'settings.json'; if (Test-Path $sf) { try { return (Get-Content $sf -Raw | ConvertFrom-Json) } catch {} }; return $null }
function Read-Control { $cf = Join-Path $Data 'control.json'; if (Test-Path $cf) { try { return [string](Get-Content $cf -Raw | ConvertFrom-Json).action } catch {} }; return '' }
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
function Set-AutoStart($on) { # per-user, no admin
  try {
    if ($on) { Set-ItemProperty -Path $RunKey -Name 'AirRegisterAirposLook' -Value ('"' + "$env:SystemRoot\System32\wscript.exe" + '" "' + "$Root\Air Register.vbs" + '"') }
    else { Remove-ItemProperty -Path $RunKey -Name 'AirRegisterAirposLook' -ErrorAction SilentlyContinue }
  } catch { Say "auto-start change failed: $_" }
}
function Show-Taskbar {
  try { Add-Type -Namespace AirReg -Name Tb -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr FindWindow(string c, string t); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);' -ErrorAction SilentlyContinue
        $h = [AirReg.Tb]::FindWindow('Shell_TrayWnd', $null); if ($h -ne [IntPtr]::Zero) { [void][AirReg.Tb]::ShowWindow($h, 5) } } catch {}
}

# ---- updates (downloaded + sha512-verified by the server into $Data\updates) ----
function Install-PendingUpdate {
  $pf = Join-Path $Data 'updates\pending.json'
  if (-not (Test-Path $pf)) { return $false }
  try {
    $p = Get-Content $pf -Raw | ConvertFrom-Json
    $file = [string]$p.file
    if (-not (Test-Path $file) -or -not ($file.StartsWith((Join-Path $Data 'updates')))) { throw 'update file missing' }
    # second guard (the server already checks): only OUR installer runs, never a store Air Register setup
    if ((Split-Path $file -Leaf) -notmatch '^AirRegister-AirposLook-Setup-\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\.exe$') { throw 'not an Air Max installer' }
    $hex = (Get-FileHash -Algorithm SHA512 -Path $file).Hash
    $bytes = for ($i = 0; $i -lt $hex.Length; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }
    if ([Convert]::ToBase64String([byte[]]$bytes) -ne $p.sha512) { throw 'sha512 mismatch' }
    Say "installing update $($p.version)"
    $proc = Start-Process -FilePath $file -ArgumentList '/S' -Wait -PassThru
    Say "update installer exit code $($proc.ExitCode)"
  } catch { Say "update skipped: $_" }
  Remove-Item $pf -Force -ErrorAction SilentlyContinue
  Get-ChildItem (Join-Path $Data 'updates') -Filter '*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  return $true
}

if ($first) {
  Say '---- start'
  # Both apps sign in as the SAME AIR POS station (shared device id), and Register Mode / the keyboard lock would fight,
  # so never run next to an open store Air Register. (We cannot change the store app; it does not check for us.)
  if (Store-AppRunning) { $mutex.ReleaseMutex(); Fail 'The regular Air Register is open on this PC. Close it first, then start Air Max. Only one of the two can run at a time.' }
  # A verified update left from last time installs before anything starts, then we restart.
  if (Install-PendingUpdate) { $mutex.ReleaseMutex(); Start-Process "$env:SystemRoot\System32\wscript.exe" -ArgumentList "`"$Root\Air Register.vbs`""; exit 0 }
  # ---- printer / cash drawer ----
  $helper = Join-Path $Root 'app\hw\AirRegisterHw.exe'
  if (-not (Test-Path $helper)) { Say 'built-in hardware helper missing' }
  # Optional legacy mode: use the AIR POS hardware service instead of the built-in helper.
  $hwMode = ''; $sf = Join-Path $Data 'settings.json'
  if (Test-Path $sf) { try { $hwMode = [string](Get-Content $sf -Raw | ConvertFrom-Json).hardware } catch {} }
  if ($hwMode -eq 'airpos' -and -not (PortOpen 20001)) {
    $exe = Find-HardwareService
    if ($exe) {
      Say "starting AIR POS hardware service (legacy mode): $exe"
      $hw = Start-Process -FilePath $exe -ArgumentList '--urls','http://localhost:20001' -WorkingDirectory (Split-Path $exe) -WindowStyle Hidden -PassThru
      $t = 0; while (-not (PortOpen 20001) -and $t -lt 30) { Start-Sleep 1; $t++ }
    } else { Say 'legacy mode: AIR POS hardware service not found' }
  }
  # ---- Air Register server ----
  if (-not (Start-Server)) { Fail "Air Max could not start (port $uiPort busy?). Log: $LogDir" }
}

# ---- window ----
$st = Read-Settings
$registerMode = [bool]($st -and $st.registerMode)
$fullScreen = $registerMode -or [bool]($st -and $st.fullScreen)
if ($first) { Set-AutoStart $registerMode; Remove-Item (Join-Path $Data 'control.json') -Force -ErrorAction SilentlyContinue }
$winProfile = Join-Path $Data 'window-profile'
$needle = [regex]::Escape($winProfile)
function Window-Alive { [bool](Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match $needle }) }
function Close-Window { # only OUR Edge window (own profile). Never other programs (RustDesk, AIR POS, the user's browser).
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match $needle } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Open-Window {
  # Full screen = Edge kiosk (covers the taskbar, no address bar, survives the monitor sleeping). Otherwise an app window.
  $mode = if ($fullScreen) { @("--kiosk", $uiUrl, '--edge-kiosk-type=fullscreen', '--no-first-run', '--kiosk-idle-timeout-minutes=0') } else { @("--app=$uiUrl", '--start-maximized') }
  $edgeArgs = $mode + @("--user-data-dir=`"$winProfile`"", '--no-first-run', '--no-default-browser-check', '--disable-features=Translate,TouchpadOverscrollHistoryNavigation', '--disable-pinch', '--overscroll-history-navigation=0')
  return Start-Process -FilePath $edge -ArgumentList $edgeArgs -PassThru
}
# ---- customer display: read-only page /customer in a 2nd Edge window (own profile) on the second monitor ----
# On when a second monitor is found, unless Settings > Screens & Register Mode > Customer display is off (settings.json customerDisplay=false).
$custProfile = Join-Path $Data 'customer-profile'
$custNeedle = [regex]::Escape($custProfile)
function Customer-Screen { try { return ([System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1) } catch { return $null } }
function Customer-Wanted { $s = Read-Settings; return -not ($s -and $s.customerDisplay -eq $false) }
function Customer-Procs { Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match $custNeedle } }
function Close-Customer { Customer-Procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
function Open-Customer($scr) {
  $b = $scr.Bounds
  $a = @("--app=$($uiUrl)customer", "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)", '--start-fullscreen', "--user-data-dir=`"$custProfile`"",
         '--no-first-run', '--no-default-browser-check', '--disable-features=Translate,TouchpadOverscrollHistoryNavigation', '--disable-pinch', '--overscroll-history-navigation=0')
  Say "customer display on $($scr.DeviceName) at $($b.X),$($b.Y) size $($b.Width)x$($b.Height)"
  [void](Start-Process -FilePath $edge -ArgumentList $a)
}
function Focus-Main { # give the keyboard and the barcode scanner back to the register window
  try {
    Add-Type -Namespace AirReg -Name Fg -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match $needle -and $_.CommandLine -notmatch '--type=' } |
      ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { [void][AirReg.Fg]::SetForegroundWindow($p.MainWindowHandle) } }
  } catch {}
}
function Sync-Customer($focus) { # follows the setting and the monitors; reopens the display if it was closed
  $scr = if (Customer-Wanted) { Customer-Screen } else { $null }
  $alive = [bool](Customer-Procs)
  if ($scr -and -not $alive) { Open-Customer $scr; if ($focus) { Start-Sleep 2; Focus-Main } }
  elseif (-not $scr -and $alive) { Say 'customer display off (setting off or no second monitor)'; Close-Customer }
}
$edge = Find-Edge
if (-not $edge) { Start-Process $uiUrl; Say 'Edge not found; opened default browser'; if (-not $first) { exit 0 } }
else {
  if ($first) { Sync-Customer $false }   # before the register window, so the register window ends up with the keyboard
  $w = Open-Window
  if (-not $first) { exit 0 }
  Say "window open (edge pid $($w.Id)) fullScreen=$fullScreen registerMode=$registerMode"
  $lock = $null
  if ($registerMode) {
    $lp = Join-Path $Root 'RegisterLock.ps1'
    if (Test-Path $lp) { $lock = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$lp`"", '-ParentPid', $PID) -WindowStyle Hidden -PassThru }
  }
  $fails = 0; $updateNow = $false
  while ($true) {
    Start-Sleep 2
    $ctl = Read-Control
    if ($ctl -eq 'exit') { Say 'exit requested from Air Register (manager login)'; Close-Window; break }
    if ($ctl -eq 'update') { Say 'Update now pressed in Air Register: closing, installing, restarting'; $updateNow = $true; Close-Window; break }   # 1.2.3
    # watchdog: the server stopped (crash) -> start it again; the page reconnects by itself and recovers the open sale
    if (-not (Up "$($uiUrl)api/state")) { $fails++; if ($fails -ge 2) { Say 'watchdog: server not answering, restarting it'; [void](Start-Server); $fails = 0 } } else { $fails = 0 }
    if (-not (Window-Alive)) {
      if ($registerMode) { Say 'Register Mode: window closed, reopening'; Start-Sleep 1; $w = Open-Window; continue }
      break
    }
    Sync-Customer $true
    if ($lock -and $lock.HasExited) { Say 'Register Mode: lock helper stopped, restarting it'; $lock = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$lp`"", '-ParentPid', $PID) -WindowStyle Hidden -PassThru }
  }
  Close-Customer
  if ($lock) { try { Stop-Process -Id $lock.Id -Force -ErrorAction SilentlyContinue } catch {} }
  Show-Taskbar
  Remove-Item (Join-Path $Data 'control.json') -Force -ErrorAction SilentlyContinue
}

Say 'window closed; stopping server'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -eq (Join-Path $Root 'node\node.exe') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# Only stop the hardware service if we started it AND AIR POS is not running (AIR POS relies on it).
if ($hw -and -not (Get-Process -Name 'AirPos' -ErrorAction SilentlyContinue)) { try { $hw | Stop-Process -Force -ErrorAction SilentlyContinue } catch {} }
[void](Install-PendingUpdate)  # update downloaded during the day installs now that the window is closed
$mutex.ReleaseMutex()
if ($updateNow) { Say 'restarting Air Register after Update now'; Start-Process "$env:SystemRoot\System32\wscript.exe" -ArgumentList "`"$Root\Air Register.vbs`"" }   # 1.2.3
Say 'stopped'
