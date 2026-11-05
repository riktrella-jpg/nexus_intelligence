@echo off
chcp 65001 >nul
title NEXUS Intelligence + Control de Calidad OIC
cd /d "%~dp0"

echo ============================================================================
echo   NEXUS INTELLIGENCE · PLATAFORMA INTEGRAL + CONTROL DE CALIDAD OIC
echo ============================================================================
echo.
echo [1/2] Iniciando servicio Python OIC (FastAPI en http://127.0.0.1:8765)...
start "NEXUS OIC Python API" cmd /k "cd /d "%~dp0backend\app\oic" && python -m uvicorn servidor_demo:app --host 127.0.0.1 --port 8765"

echo [2/2] Iniciando interfaz web NEXUS Intelligence (http://127.0.0.1:3000/oic/rescisiones)...
cd /d "%~dp0frontend"
set "PATH=C:\Users\ricardo.escamilla\nodejs\node-v22.14.0-win-x64;%PATH%"
npm.cmd run dev
pause
