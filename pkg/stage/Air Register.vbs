' Starts Air Max (the AIR POS look app; was "Air Register (AIR POS look)") with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\AirRegister.ps1""", 0, False
