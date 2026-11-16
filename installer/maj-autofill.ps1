# Al Wasit - mise a jour automatique des extensions Autofill TLS et Autofill BLS.
# Lance toutes les 15 minutes par le Planificateur de taches (installer-maj.cmd l'installe).
# 1. lit version.json sur GitHub (allwassitbilal-droid/alwasit-maj)
# 2. pour chaque extension plus ancienne sur ce PC : telecharge le ZIP, verifie (sha256 + nom de l'extension),
#    garde une copie de l'ancienne version, copie les nouveaux fichiers DANS LE MEME DOSSIER (manifest.json en dernier).
# 3. l'extension voit les nouveaux fichiers et redemarre toute seule (autoreload.js). Les donnees ne bougent pas.
$ErrorActionPreference = 'Stop'
$Base = 'https://raw.githubusercontent.com/allwassitbilal-droid/alwasit-maj/main'
$Dir  = Join-Path $env:LOCALAPPDATA 'AlWasitMaj'
$Cfg  = Join-Path $Dir 'config.json'
$Log  = Join-Path $Dir 'maj.log'
$Names = @{ tls = 'Autofill TLS'; bls = 'Autofill BLS' }

function Write-Log([string]$m) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"
  Add-Content -Path $Log -Value $line -Encoding UTF8
  Write-Host $line
}
function Read-Json([string]$path) { Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json }

New-Item -ItemType Directory -Path $Dir -Force | Out-Null
# Keep the log small
if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 512KB) { Get-Content $Log -Tail 300 | Set-Content $Log -Encoding UTF8 }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (!(Test-Path $Cfg)) { Write-Log 'Pas de config.json : relancez installer-maj.cmd'; exit 1 }
$cfg = Read-Json $Cfg

try {
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  # raw.githubusercontent.com answers text/plain: parse the JSON ourselves
  $remote = (Invoke-WebRequest -Uri "$Base/version.json?t=$stamp" -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
} catch { Write-Log "Pas de connexion a GitHub ($($_.Exception.Message))"; exit 0 }

foreach ($app in 'tls', 'bls') {
  try {
    $folder = $cfg.$app
    $r = $remote.$app
    if (-not $folder -or -not $r) { continue }
    $man = Join-Path $folder 'manifest.json'
    if (!(Test-Path $man)) { Write-Log "${app}: manifest.json introuvable dans $folder"; continue }
    $cur = Read-Json $man
    if ($cur.name -ne $Names[$app]) { Write-Log "${app}: le dossier $folder n'est pas $($Names[$app]) - rien fait"; continue }
    if ([version]$r.version -le [version]$cur.version) { continue }

    Write-Log "${app}: $($cur.version) -> $($r.version)"
    $tmp = Join-Path $env:TEMP "alwasit-maj-$app"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    $zip = Join-Path $tmp 'maj.zip'
    Invoke-WebRequest -Uri "$Base/$($r.zip)?t=$stamp" -OutFile $zip -UseBasicParsing -TimeoutSec 180
    if ($r.sha256 -and ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $r.sha256.ToUpper())) {
      Write-Log "${app}: fichier telecharge abime (sha256), nouvel essai dans 15 min"; continue
    }
    $x = Join-Path $tmp 'x'
    Expand-Archive -Path $zip -DestinationPath $x -Force
    $newMan = Get-ChildItem $x -Recurse -Filter manifest.json | Select-Object -First 1
    if (!$newMan) { Write-Log "${app}: ZIP sans manifest.json"; continue }
    $new = Read-Json $newMan.FullName
    if ($new.name -ne $Names[$app] -or $new.version -ne $r.version) { Write-Log "${app}: ZIP inattendu ($($new.name) $($new.version))"; continue }
    $src = $newMan.DirectoryName

    # Copy of the version in place (the last 3 are kept)
    $bak = Join-Path $Dir "sauvegardes\$app-$($cur.version)"
    robocopy $folder $bak /E /XD .claude /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    Get-ChildItem (Join-Path $Dir 'sauvegardes') -Directory -Filter "$app-*" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Recurse -Force

    # New files into the same folder; manifest.json last so the extension only sees the new version once all is there
    robocopy $src $folder /E /XF manifest.json /R:3 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Log "${app}: copie impossible (robocopy $LASTEXITCODE) - Chrome bloque un fichier ? nouvel essai dans 15 min"; continue }
    Copy-Item $newMan.FullName $man -Force
    Write-Log "${app}: v$($r.version) installee dans $folder"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Log "${app}: erreur $($_.Exception.Message)"
  }
}
