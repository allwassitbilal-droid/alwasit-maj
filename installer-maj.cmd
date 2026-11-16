@echo off
chcp 65001 >nul
title Al Wasit - mise a jour automatique
echo Installation de la mise a jour automatique (Autofill TLS / Autofill BLS)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $f=Join-Path $env:TEMP 'alwasit-installer.ps1'; Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/allwassitbilal-droid/alwasit-maj/main/installer/installer.ps1?t='+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -OutFile $f; & $f"
echo.
pause
