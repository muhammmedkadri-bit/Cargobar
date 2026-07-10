' Alternatif otomatik başlatma yöntemi (yönetici hakları GEREKMEZ).
' node-windows servis kurulumu yerine bunu kullanmak isterseniz:
'
'   1) Bu dosyayı (run-hidden.vbs) print-agent klasöründe bırakın.
'   2) Windows tuşu + R -> "shell:startup" yazıp Enter'a basın, açılan
'      klasöre bu dosyanın bir KISAYOLUNU (shortcut) koyun.
'   3) Bilgisayar her açıldığında ajan görünmez şekilde arka planda
'      otomatik başlar (konsol penceresi açılmaz).
'
' Not: Servis yöntemi (install-service.js) daha sağlamdır çünkü oturum
' açmadan önce de başlar ve çöktüğünde otomatik yeniden başlar. Bu VBS
' yöntemi ise sadece kullanıcı oturum açtığında çalışır - basit
' kurulumlar için yeterlidir.

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "node server.js", 0, False
