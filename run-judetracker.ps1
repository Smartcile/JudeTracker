# run-judetracker.ps1 - spin up the JudeTracker stack and open it in the browser
#
# Usage (from the repo root, where compose.yaml lives):
#   powershell -ExecutionPolicy Bypass -File .\run-judetracker.ps1
#   powershell -ExecutionPolicy Bypass -File .\run-judetracker.ps1 -Rebuild
#   powershell -ExecutionPolicy Bypass -File .\run-judetracker.ps1 -Down
#   powershell -ExecutionPolicy Bypass -File .\run-judetracker.ps1 -Port 9000
#
# First run: the app boots with an empty database and asks you to create a PIN.

param(
  [switch]$Rebuild,
  [switch]$Down,
  [switch]$NoOpen,
  [int]$Port = 0
)

# Native tools (docker, curl) write progress to stderr; we fail on exit codes instead.
$ErrorActionPreference = "Continue"
$env:POWERSHELL_TELEMETRY_OPTOUT = "1"

function Compose { param([string[]]$Args2) & docker compose @Args2 }
function Die { param([string]$Msg) Write-Host $Msg -ForegroundColor Red; exit 1 }

Write-Host "== JudeTracker launcher ==" -ForegroundColor Cyan

docker version --format "{{.Server.Version}}" *> $null
if ($LASTEXITCODE -ne 0) { Die "Docker is not running. Start Docker Desktop and try again." }

# Port precedence: -Port > $env:APP_PORT > 8090 (kept in sync with compose.yaml)
if ($Port -eq 0) {
  if ($env:APP_PORT -match '^\d+$') { $Port = [int]$env:APP_PORT } else { $Port = 8090 }
}
$env:APP_PORT = "$Port"

if ($Down) {
  Compose @("down")
  Write-Host "Stack stopped (data volumes are kept)." -ForegroundColor Green
  exit 0
}

if ($Rebuild) {
  Write-Host "Building images..."
  Compose @("up", "-d", "--build")
} else {
  Write-Host "Starting stack (use -Rebuild to force a rebuild)..."
  Compose @("up", "-d")
}
if ($LASTEXITCODE -ne 0) { Die "docker compose failed." }

Write-Host "Waiting for the app to become healthy..."
$url = "http://localhost:$Port/api/health"
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 2
    if ($r.ok) { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 2
}

if (-not $ok) {
  Write-Host "The app did not report healthy in time. Check logs with:" -ForegroundColor Yellow
  Write-Host "  docker compose logs app" -ForegroundColor Yellow
  exit 1
}

$page = "http://localhost:$Port"
Write-Host "JudeTracker is up: $page" -ForegroundColor Green
Write-Host "First visit: create your 4-6 digit PIN." -ForegroundColor DarkGray

if (-not $NoOpen) {
  Start-Process $page
}

Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  docker compose logs -f app      # follow app logs"
Write-Host "  $PSCommandPath -Down            # stop the stack (keeps your data)"
Write-Host "  $PSCommandPath -Rebuild         # rebuild + restart"
