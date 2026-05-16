# Close ALL running terminals and processes related to the app
# This is more aggressive to ensure everything stops

Write-Host "Force closing ALL terminals and processes..." -ForegroundColor Yellow

# Kill ALL Node processes
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "✓ Killed Node processes" -ForegroundColor Green

# Kill ALL Python processes
Get-Process -Name "python" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "python.exe" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "✓ Killed Python processes" -ForegroundColor Green

# Kill Ollama
Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "✓ Killed Ollama processes" -ForegroundColor Green

# Kill any remaining PowerShell terminal instances (except current)
Get-Process -Name "pwsh" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "✓ Killed PowerShell terminals" -ForegroundColor Green

# Kill any conhost (console host) processes
Get-Process -Name "conhost" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "✓ Killed Console Host processes" -ForegroundColor Green

Write-Host "`nAll processes terminated!" -ForegroundColor Green
Write-Host "You can now safely restart your services." -ForegroundColor Cyan

