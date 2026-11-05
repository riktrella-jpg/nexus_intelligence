@echo off
cd /d "%~dp0"
py -m pip install -r requirements-api.txt
py -m uvicorn servidor_demo:app --host 127.0.0.1 --port 8765
pause
