@echo off
REM Little Bean - starts a local web server so the browser allows microphone (voice) input.
REM Opening index.html directly (file://) blocks speech recognition in Chrome and Edge.
REM serve.py picks a free port, so it won't clash with other programs using port 8000.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py serve.py
  goto end
)
python serve.py
if %errorlevel%==9009 (
  echo.
  echo  Python was not found. Install it from https://www.python.org/downloads/
  echo  and tick "Add python.exe to PATH" during setup, then run this file again.
  echo  Or open the folder in VS Code and use the "Live Server" extension instead.
)
:end
echo.
pause
