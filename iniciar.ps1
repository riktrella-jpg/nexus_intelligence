# Script PowerShell para iniciar NEXUS INTELLIGENCE
$root = $PSScriptRoot
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "       INICIANDO NEXUS INTELLIGENCE (Local)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Backend
Write-Host "`n[1/2] Verificando Backend FastAPI (http://127.0.0.1:8000)..." -ForegroundColor Yellow
$be = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if (-not $be) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
    Start-Sleep -Seconds 2
} else {
    Write-Host "Backend ya está en ejecución." -ForegroundColor Green
}

# 2. Frontend
Write-Host "`n[2/2] Verificando Frontend Next.js (http://127.0.0.1:3000)..." -ForegroundColor Yellow
$fe = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if (-not $fe) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm.cmd run dev"
    Start-Sleep -Seconds 2
} else {
    Write-Host "Frontend ya está en ejecución." -ForegroundColor Green
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "  Plataforma lista en: http://127.0.0.1:3000" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Start-Process "http://127.0.0.1:3000"
