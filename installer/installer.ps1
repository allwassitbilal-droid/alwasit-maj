# Al Wasit - installation de la mise a jour automatique sur ce PC (une seule fois).
# - trouve les dossiers des extensions Autofill TLS / Autofill BLS chargees dans Chrome
# - enregistre maj-autofill.ps1 dans %LOCALAPPDATA%\AlWasitMaj
# - cree la tache "AlWasit MAJ" : a l'ouverture de session puis toutes les 15 minutes, sans fenetre
$ErrorActionPreference = 'Stop'
$Base = 'https://raw.githubusercontent.com/allwassitbilal-droid/alwasit-maj/main'
$Dir  = Join-Path $env:LOCALAPPDATA 'AlWasitMaj'
$Names = @{ tls = 'Autofill TLS'; bls = 'Autofill BLS' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Path $Dir -Force | Out-Null
Add-Type -AssemblyName System.Windows.Forms

function Read-Json([string]$path) { Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Name-Of([string]$folder) {
  $m = Join-Path $folder 'manifest.json'
  if (Test-Path $m) { try { return (Read-Json $m).name } catch { } }
  return $null
}

Write-Host ''
Write-Host '=== Al Wasit : mise a jour automatique des extensions ===' -ForegroundColor Cyan
Write-Host ''

# 1. Folders of the unpacked extensions, as Chrome knows them (all Chrome profiles).
#    Read as text: Chrome's preference files can have keys PowerShell 5 refuses as JSON.
$found = @{}
$prefs = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data') -Recurse -Depth 1 -Include 'Secure Preferences', 'Preferences' -ErrorAction SilentlyContinue
foreach ($p in $prefs) {
  try {
    $txt = [IO.File]::ReadAllText($p.FullName)
    foreach ($m in [regex]::Matches($txt, '"path"\s*:\s*"([A-Za-z]:[^"]+)"')) {
      $path = [regex]::Unescape($m.Groups[1].Value)
      if (!(Test-Path (Join-Path $path 'manifest.json'))) { continue }
      $n = Name-Of $path
      foreach ($app in 'tls', 'bls') { if ($n -eq $Names[$app] -and !$found[$app]) { $found[$app] = $path } }
    }
  } catch { }
}

# 2. Not found: ask
foreach ($app in 'tls', 'bls') {
  if ($found[$app]) { Write-Host "$($Names[$app]) : $($found[$app])" -ForegroundColor Green; continue }
  Write-Host "$($Names[$app]) : pas trouve dans Chrome." -ForegroundColor Yellow
  $ans = Read-Host "  Cette extension est-elle installee sur ce PC ? (o/n)"
  if ($ans -notmatch '^[oOyY]') { continue }
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "Choisissez le dossier de l'extension $($Names[$app]) (celui qui contient manifest.json)"
  $dlg.SelectedPath = Join-Path $env:USERPROFILE 'Downloads'
  if ($dlg.ShowDialog() -eq 'OK') {
    if ((Name-Of $dlg.SelectedPath) -eq $Names[$app]) { $found[$app] = $dlg.SelectedPath; Write-Host "  -> $($dlg.SelectedPath)" -ForegroundColor Green }
    else { Write-Host "  Ce dossier n'est pas $($Names[$app]) (manifest.json)." -ForegroundColor Red }
  }
}
if (!$found['tls'] -and !$found['bls']) { Write-Host 'Aucune extension : rien a installer.' -ForegroundColor Red; exit 1 }

@{ tls = $found['tls']; bls = $found['bls'] } | ConvertTo-Json | Set-Content (Join-Path $Dir 'config.json') -Encoding UTF8

# 3. The updater + a hidden launcher
Invoke-WebRequest -Uri "$Base/installer/maj-autofill.ps1" -OutFile (Join-Path $Dir 'maj-autofill.ps1') -UseBasicParsing
$ps1 = Join-Path $Dir 'maj-autofill.ps1'
$vbs = Join-Path $Dir 'lancer.vbs'
"CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """"$ps1"""""", 0, False" | Set-Content $vbs -Encoding ASCII

# 4. Scheduled task: at logon, then every 15 minutes (this user, no admin needed)
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
try {
  Register-ScheduledTask -TaskName 'AlWasit MAJ' -Action $action -Trigger @($every, $logon) -Settings $set -Force | Out-Null
} catch {
  Write-Host "Tache planifiee : echec ($($_.Exception.Message))" -ForegroundColor Red; exit 1
}

Write-Host ''
Write-Host 'Premiere verification...' -ForegroundColor Cyan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps1
Write-Host ''
Write-Host 'C''est installe. Toutes les 15 minutes ce PC prend la derniere version tout seul.' -ForegroundColor Green
Write-Host "Journal : $Dir\maj.log"
Write-Host 'Pour enlever : Unregister-ScheduledTask -TaskName "AlWasit MAJ" -Confirm:$false'
