# Build and deploy the static edition to raimbaut.yusupov.cloud.
#   usage:  .\deploy.ps1          (refuses if derived data is stale)
#           .\deploy.ps1 -Force   (skip the staleness guard)
# The server (ssh alias "yusupov", port 2708) serves the site root from
# /home/django/raimbaut-yusupov. Pure static: build -> pack -> upload -> swap.
# It ships a tarball (rather than piping tar through the PowerShell pipeline,
# which corrupts binary files like fonts/images) and needs no local rsync.
param([switch]$Force)
$ErrorActionPreference = "Stop"

$Remote = "yusupov"
$Port   = 2708
$Dest   = "/home/django/raimbaut-yusupov"
$Tar    = "_deploy.tgz"          # relative name: avoids scp's drive-letter colon issue

# guard: never ship a site that doesn't reflect the corpus
if (-not $Force) {
    python (Join-Path $PSScriptRoot "manage.py") check
    if ($LASTEXITCODE -ne 0) { throw "derived data is stale (python manage.py stale), or re-run with -Force" }
}

# a deploy tag only means something if the tree it points at is what shipped
$Dirty = [bool](git -C $PSScriptRoot status --porcelain)
if ($Dirty) { Write-Host "! uncommitted changes: deploying anyway, but no deploy tag will be written" -ForegroundColor Yellow }

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

# extract next to the live dir, sanity-check, then swap: the live site is never
# empty or half-extracted, and a failed extract leaves it untouched
$Swap = "set -e; rm -rf '$Dest.new' '$Dest.old'; mkdir '$Dest.new'; " +
        "tar xzf '/tmp/$Tar' -C '$Dest.new'; test -s '$Dest.new/index.html'; " +
        "chown -R django:django '$Dest.new'; chmod 755 '$Dest.new'; " +
        "mv '$Dest' '$Dest.old'; mv '$Dest.new' '$Dest'; rm -rf '$Dest.old' '/tmp/$Tar'"
ssh -p $Port $Remote $Swap
if ($LASTEXITCODE -ne 0) { throw "remote deploy failed (live site left as it was)" }

Remove-Item $Tar -Force
Set-Location $PSScriptRoot

if (-not $Dirty) {
    $Tag = "deploy/" + (Get-Date -Format "yyyy-MM-dd-HHmm")
    git tag $Tag
    Write-Host "tagged $Tag"
}
Write-Host "deployed -> https://raimbaut.yusupov.cloud" -ForegroundColor Green
