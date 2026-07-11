' Cargobar Print Agent - Gizli Arka Plan Başlatıcı
' Bilgisayar her açıldığında ajan görünmez şekilde otomatik başlar.
'
' Kurulum: Bu dosyanın kısayolunu shell:startup klasörüne koy.

Dim scriptDir
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir
WshShell.Run """C:\Program Files\nodejs\node.exe"" """ & scriptDir & "\server.js""", 0, False
