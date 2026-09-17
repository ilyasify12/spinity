$ErrorActionPreference = 'Continue'
$root = 'C:\Users\ilyasify\Documents\spinity'
$log  = Join-Path $root 'install.log'
Set-Location $root

"=== START $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8
"node: $(node --version)"   | Out-File -FilePath $log -Append -Encoding utf8
"npm:  $(npm --version)"    | Out-File -FilePath $log -Append -Encoding utf8

& npm install react react-dom *>&1 | Out-File -FilePath $log -Append -Encoding utf8
"--- react exit=$LASTEXITCODE $(Get-Date -Format o) ---" | Out-File -FilePath $log -Append -Encoding utf8

& npm install -D electron electron-vite vite typescript '@vitejs/plugin-react' '@types/react' '@types/react-dom' '@types/node' electron-builder *>&1 | Out-File -FilePath $log -Append -Encoding utf8
"--- devdeps exit=$LASTEXITCODE $(Get-Date -Format o) ---" | Out-File -FilePath $log -Append -Encoding utf8

"=== ALL DONE $(Get-Date -Format o) ===" | Out-File -FilePath $log -Append -Encoding utf8
