# Air Register - Register Mode keyboard lock (started hidden by AirRegister.ps1 only when Register Mode is on).
# Blocks the Windows keys, Alt+Tab, Alt+Esc, Ctrl+Esc and Alt+F4 for the person at the register, and hides the taskbar.
# - Keys sent by remote help (RustDesk) are "injected" and always pass, so AK Local Solutions can still switch windows.
# - Ctrl+Alt+Del can never be blocked by an app (Windows security). Exit: Ctrl+Shift+Q in Air Register + manager login.
# - Never touches RustDesk or any other program; it only hides/shows the taskbar windows.
param([int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AirLock {
  delegate IntPtr Proc(int code, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct KB { public uint vk, scan, flags, time; public IntPtr extra; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string t);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint f);
  static IntPtr hook = IntPtr.Zero; static Proc keep;
  static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  static IntPtr Fn(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      KB k = (KB)Marshal.PtrToStructure(l, typeof(KB));
      bool injected = (k.flags & 0x10) != 0;          // LLKHF_INJECTED: remote help / automation -> let it through
      bool alt = (k.flags & 0x20) != 0;                // LLKHF_ALTDOWN
      if (!injected) {
        if (k.vk == 0x5B || k.vk == 0x5C) return (IntPtr)1;                 // Windows keys
        if (alt && (k.vk == 0x09 || k.vk == 0x1B || k.vk == 0x73)) return (IntPtr)1; // Alt+Tab, Alt+Esc, Alt+F4
        if (k.vk == 0x1B && Down(0x11) && !Down(0x10)) return (IntPtr)1;    // Ctrl+Esc (Start menu); Ctrl+Shift+Esc (Task Manager) stays
      }
    }
    return CallNextHookEx(hook, code, w, l);
  }
  public static void Start() { keep = Fn; hook = SetWindowsHookEx(13, keep, GetModuleHandle(null), 0); SetThreadExecutionState(0x80000001); } // WH_KEYBOARD_LL; ES_CONTINUOUS|ES_SYSTEM_REQUIRED (PC stays awake, screen may sleep)
  public static void Stop() { if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook); hook = IntPtr.Zero; SetThreadExecutionState(0x80000000); Taskbar(true); }
  public static void Taskbar(bool show) {
    int cmd = show ? 5 : 0;
    IntPtr t = FindWindow("Shell_TrayWnd", null); if (t != IntPtr.Zero) ShowWindow(t, cmd);
    IntPtr s = IntPtr.Zero; while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) ShowWindow(s, cmd);
  }
}
"@
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
  [AirLock]::Taskbar($false)   # Explorer may bring the taskbar back (restart, new monitor); hide it again
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { [System.Windows.Forms.Application]::Exit() } # launcher gone -> unlock
})
try {
  [AirLock]::Start(); [AirLock]::Taskbar($false); $timer.Start()
  [System.Windows.Forms.Application]::Run()   # message loop needed by the keyboard hook
} finally { $timer.Stop(); [AirLock]::Stop() }
