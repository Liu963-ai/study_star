Get-CimInstance Win32_Process -Filter "Name='python3.12.exe'" |
  Where-Object { $_.CommandLine -like '*fill_missing_loop*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ("stopped " + $_.ProcessId) }
