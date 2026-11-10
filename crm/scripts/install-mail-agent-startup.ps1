$ErrorActionPreference = "Stop"
$agent = Join-Path $PSScriptRoot "start-mail-agent.bat"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Irbis Mail Agent.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $agent
$shortcut.WorkingDirectory = Split-Path $agent -Parent
$shortcut.WindowStyle = 7
$shortcut.Description = "Локальный SMTP/IMAP-агент рассылки Ирбиса"
$shortcut.Save()
Write-Host "Ярлык добавлен в автозагрузку: $shortcutPath"
Write-Host "Запустить агента сейчас: $agent"
