# Build and deploy the static edition to raimbaut.yusupov.cloud.
#   usage:  .\deploy.ps1
# The server (ssh alias "yusupov", port 2708) serves the site root from
# /home/django/raimbaut-yusupov. Pure static: build -> pack -> upload -> extract.
# It ships a tarball (rather than piping tar through the PowerShell pipeline,
# which corrupts binary files like fonts/images) and needs no local rsync.
$ErrorActionPreference = "Stop"

$Remote = "yusupov"
$Port   = 2708
$Dest   = "/home/django/raimbaut-yusupov"
$Tar    = "_deploy.tgz"          # relative name: avoids scp's drive-letter colon issue

Set-Location (Join-Path $PSScriptRoot "site")

Write-Host "> building..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "> packing..."
if (Test-Path $Tar) { Remove-Item $Tar -Force }
tar czf $Tar -C _site .
if ($LASTEXITCODE -ne 0) { throw "tar failed" }

Write-Host "> uploading to ${Remote}:${Dest} ..."
scp -P $Port $Tar "${Remote}:/tmp/$Tar"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }

# clear the destination (clean mirror), extract, hand files to the folder owner
ssh -p $Port $Remote "find '$Dest' -mindepth 1 -delete && tar xzf '/tmp/$Tar' -C '$Dest' && chown -R django:django '$Dest' && rm -f '/tmp/$Tar'"
if ($LASTEXITCODE -ne 0) { throw "remote deploy failed" }

Remove-Item $Tar -Force
Write-Host "deployed -> https://raimbaut.yusupov.cloud" -ForegroundColor Green

Set-Location $PSScriptRoot