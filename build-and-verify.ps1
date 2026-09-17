# Build + verification harness.
#
# WHY THIS RUNS IN TEMP: child processes in this environment cannot create files
# under C:\Users\ilyasify\Documents (verified: Set-Content/New-Item fail with
# "Could not find file" there, while $env:TEMP succeeds). npm needs to write
# node_modules, so the project is mirrored into TEMP and built there.
$ErrorActionPreference = 'Continue'
$proj = 'C:\Users\ilyasify\Documents\spinity'
$b    = Join-Path $env:TEMP 'spinity-build'
$log  = Join-Path $env:TEMP 'spinity-build.log'

function Log([string]$m) {
  "$(Get-Date -Format 'HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8
}

"=== START $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8

New-Item -ItemType Directory -Force -Path $b | Out-Null

# Mirror ONLY sources. node_modules is deliberately preserved between runs so the
# slow electron download is not repeated on every verify.
Copy-Item -Path (Join-Path $proj 'src') -Destination $b -Recurse -Force -ErrorAction SilentlyContinue
foreach ($f in 'package.json','tsconfig.json','tsconfig.node.json','tsconfig.web.json','electron.vite.config.ts') {
  Copy-Item -Path (Join-Path $proj $f) -Destination $b -Force -ErrorAction SilentlyContinue
}
Log "mirrored sources -> $b"
Log "node=$(node --version) npm=$(npm --version)"

Set-Location $b

if (-not (Test-Path (Join-Path $b 'package.json'))) {
  Log 'FATAL: package.json missing in mirror'
  exit 1
}

# Install by name (no pinned versions) so npm resolves current releases and
# writes them into package.json. The resolved versions get reported back.
# Single-source the install: dependencies are declared in package.json, so npm
# reconciles the tree in one pass. (Undeclared packages get PRUNED here, which
# is what previously removed react/react-dom and broke `react/jsx-runtime`.)
& npm install --no-audit --no-fund *>&1 | Out-File -FilePath $log -Append -Encoding utf8
Log "npm install exit=$LASTEXITCODE"

# Install with PINNED versions for the vite/electron-vite/plugin-react trio.
# Verified constraint (from npm peer metadata):
#   electron-vite@5.0.0      peer vite ^5||^6||^7
#   @vitejs/plugin-react@6.x peer vite ^8        <- conflicts with electron-vite
#   @vitejs/plugin-react@5.x peer vite ...||^7||^8 <- satisfies both
# Installing `vite@*` resolves to vite 8 and fails with ERESOLVE, so vite is
# pinned to ^7 here.
# NOTE: vite is pinned to ^7 in package.json on purpose. electron-vite@5 peer-
# requires vite ^5||^6||^7, while @vitejs/plugin-react@6 requires vite ^8.
# Letting npm resolve `vite@latest` (8.x) fails with ERESOLVE.

Log '--- resolved versions ---'
$pkg = Get-Content (Join-Path $b 'package.json') -Raw | ConvertFrom-Json
($pkg.dependencies.PSObject.Properties | ForEach-Object { "dep $($_.Name) $($_.Value)" }) | Out-File -FilePath $log -Append -Encoding utf8
($pkg.devDependencies.PSObject.Properties | ForEach-Object { "dev $($_.Name) $($_.Value)" }) | Out-File -FilePath $log -Append -Encoding utf8

Log '--- typecheck ---'
& npm run typecheck *>&1 | Out-File -FilePath $log -Append -Encoding utf8
Log "typecheck exit=$LASTEXITCODE"

Log '--- build ---'
& npm run build *>&1 | Out-File -FilePath $log -Append -Encoding utf8
Log "build exit=$LASTEXITCODE"

Log '=== DONE ==='
