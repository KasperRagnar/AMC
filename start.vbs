' Double-click this file on Windows to start AMC Transfer.
' The browser opens automatically. The terminal closes when you close the browser tab.

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir   = fso.GetParentFolderName(WScript.ScriptFullName)
shScript = Replace(appDir, "\", "/") & "/start.sh"

' ── Locate Git installation ─────────────────────────────────────────────────
Dim gitRoots(4)
gitRoots(0) = "C:\Program Files\Git"
gitRoots(1) = "C:\Program Files (x86)\Git"
gitRoots(2) = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Git")
gitRoots(3) = shell.ExpandEnvironmentStrings("%ProgramW6432%\Git")
gitRoots(4) = shell.ExpandEnvironmentStrings("%USERPROFILE%\scoop\apps\git\current")

Dim gitRoot
gitRoot = ""
Dim i
For i = 0 To 4
    If fso.FileExists(gitRoots(i) & "\usr\bin\mintty.exe") Then
        gitRoot = gitRoots(i)
        Exit For
    End If
Next

If gitRoot <> "" Then
    ' Launch mintty with --hold=never so the window closes automatically
    ' when the server shuts down (i.e. when the browser tab is closed).
    Dim mintty, bash
    mintty = gitRoot & "\usr\bin\mintty.exe"
    bash   = gitRoot & "\usr\bin\bash.exe"
    shell.Run Chr(34) & mintty & Chr(34) & " --hold=never " & _
              Chr(34) & bash   & Chr(34) & " -l """ & shScript & """", 1, False
Else
    ' Fall back to start.bat if Git is not installed
    shell.Run "cmd /c """ & appDir & "\start.bat""", 1, False
End If
