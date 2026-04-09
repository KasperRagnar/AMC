' Double-click this file on Windows to start AMC Transfer with no visible terminal.
' The browser opens automatically. Close the browser tab to stop the app.

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir  = fso.GetParentFolderName(WScript.ScriptFullName)
batFile = appDir & "\start.bat"

' WindowStyle 0 = hidden, bWaitOnReturn False = don't block
shell.Run "cmd /c """ & batFile & """", 0, False
