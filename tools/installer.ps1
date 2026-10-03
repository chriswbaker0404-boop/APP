# Album Tracker installer (runs from inside "Install Album Tracker.bat").
# Windows PowerShell 5.1 compatible. $t holds the full text of the .bat file,
# which carries the app (HTML) and icon as base64 sections after this script.
$ErrorActionPreference = 'Stop'

function Get-Section($name) {
  # Marker built at runtime so this script's own text never contains it.
  $marker = '@@' + 'AT-' + $name + '@@'
  $parts = $t.Split([string[]]@($marker), [StringSplitOptions]::None)
  if ($parts.Count -lt 3) { throw "The installer file is damaged (missing $name). Please download it again." }
  return [Convert]::FromBase64String(($parts[1] -replace '\s', ''))
}

function Find-Exe($paths) {
  foreach ($p in $paths) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  return $null
}

# 1. Put the app somewhere permanent, so deleting the download doesn't break it.
$dir = Join-Path $env:LOCALAPPDATA 'Album Tracker'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$html = Join-Path $dir 'Album Tracker.html'
$ico = Join-Path $dir 'Album Tracker.ico'
[IO.File]::WriteAllBytes($html, (Get-Section 'HTML'))
[IO.File]::WriteAllBytes($ico, (Get-Section 'ICO'))
Write-Host "  App saved to $dir"

# 2. Pick the browser that runs it in its own window: the default browser if
#    that's Chrome or Edge (so it sees the same saved albums), else whichever
#    of the two is installed.
$chrome = Find-Exe @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                     "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                     "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
$edge = Find-Exe @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
                   "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$defaultBrowser = ''
try {
  $defaultBrowser = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId
} catch {}
if ($defaultBrowser -like 'MSEdge*' -and $edge) { $browser = $edge }
elseif ($chrome) { $browser = $chrome }
elseif ($edge) { $browser = $edge }
else { throw 'Album Tracker needs Google Chrome or Microsoft Edge, and neither was found.' }
Write-Host "  Runs in: $browser"

$appArgs = '--app="' + ([Uri]$html).AbsoluteUri + '"'

if ($env:ALBUM_TRACKER_TEST) {
  Write-Host "  TEST: would create shortcuts -> $browser $appArgs"
  return
}

# 3. Desktop + Start Menu shortcuts with the app's own icon.
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = $shell.CreateShortcut((Join-Path $folder 'Album Tracker.lnk'))
  $lnk.TargetPath = $browser
  $lnk.Arguments = $appArgs
  $lnk.IconLocation = "$ico,0"
  $lnk.WorkingDirectory = $dir
  $lnk.Description = 'Album Tracker'
  $lnk.Save()
}
Write-Host '  Added "Album Tracker" to your Desktop and Start Menu'

# 4. Open it.
Start-Process -FilePath $browser -ArgumentList $appArgs
