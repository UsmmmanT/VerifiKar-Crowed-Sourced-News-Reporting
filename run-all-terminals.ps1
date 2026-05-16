$ErrorActionPreference = 'Stop'

$workspaceRoot = Splitp-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $workspaceRoot 'VerifiKar-BE'
$frontendPath = Join-Path $workspaceRoot 'VerifiKarFE'

if (-not (Test-Path $backendPath)) {
    throw "Backend folder not found: $backendPath"
}

if (-not (Test-Path $frontendPath)) {
    throw "Frontend folder not found: $frontendPath"
}

$activateVenv = $null
if (Test-Path (Join-Path $backendPath '.venv\Scripts\Activate.ps1')) {
    $activateVenv = Join-Path $backendPath '.venv\Scripts\Activate.ps1'
} elseif (Test-Path (Join-Path $backendPath 'venv\Scripts\Activate.ps1')) {
    $activateVenv = Join-Path $backendPath 'venv\Scripts\Activate.ps1'
}

function Start-ProjectTerminal {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,

        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    Start-Process powershell -ArgumentList @(
        '-NoExit',
        '-Command',
        "`$host.UI.RawUI.WindowTitle = '$Title'; $Command"
    ) | Out-Null
}

$backendPrefix = "Set-Location '$backendPath'; "
if ($activateVenv) {
    $backendPrefix += ". '$activateVenv'; "
}

Start-ProjectTerminal -Title 'VerifiKar API' -Command ($backendPrefix + "uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload")
Start-ProjectTerminal -Title 'VerifiKar Worker' -Command ($backendPrefix + "arq app.worker.WorkerSettings")
Start-ProjectTerminal -Title 'VerifiKar Model' -Command ($backendPrefix + "uvicorn app.services.model_server:app --host 0.0.0.0 --port 8001")
Start-ProjectTerminal -Title 'VerifiKar Frontend' -Command ("Set-Location '$frontendPath'; npm start")

Write-Host 'Started 4 terminals:'
Write-Host '- VerifiKar API'
Write-Host '- VerifiKar Worker'
Write-Host '- VerifiKar Model'
Write-Host '- VerifiKar Frontend'
