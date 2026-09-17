Start-Sleep -Seconds 15
"detached-survived $(Get-Date -Format o)" | Out-File -FilePath 'C:\Users\ilyasify\Documents\spinity\detach-test.txt' -Encoding utf8
