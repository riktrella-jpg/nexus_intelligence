@echo off
chcp 65001 >nul
echo ========================================================
echo        INICIANDO NEXUS INTELLIGENCE
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/2] Iniciando Backend FastAPI en http://127.0.0.1:8000 ...
start "NEXUS Backend" cmd /k "cd backend && .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

echo [2/2] Iniciando Frontend Next.js en http://127.0.0.1:3000 ...
start "NEXUS Frontend" cmd /k "cd frontend && npm.cmd run dev"

timeout /t 3 /nobreak >nul
echo.
echo ========================================================
echo   Plataforma iniciada exitosamente en:
echo   http://127.0.0.1:3000
echo ========================================================
start http://127.0.0.1:3000
