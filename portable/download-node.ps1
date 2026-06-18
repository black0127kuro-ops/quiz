param(
  [string]$NodeVer = "20.18.1",
  [string]$OutDir = "dist\quiz-lan-usb"
)

$ErrorActionPreference = "Stop"
$zipName = "node-v$NodeVer-win-x64.zip"
$url = "https://nodejs.org/dist/v$NodeVer/$zipName"
$zipPath = Join-Path $OutDir $zipName
$tmpDir = Join-Path $OutDir "_node_tmp"
$nodeDir = Join-Path $OutDir "node"
$extracted = Join-Path $tmpDir "node-v$NodeVer-win-x64"

Invoke-WebRequest -Uri $url -OutFile $zipPath
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force
New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
Copy-Item -Path (Join-Path $extracted "*") -Destination $nodeDir -Recurse -Force
Remove-Item $tmpDir -Recurse -Force
Remove-Item $zipPath -Force

if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
  throw "node.exe not found after extract"
}

Write-Host "Node.js portable ready in $nodeDir"
