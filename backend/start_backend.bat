@echo off
rem Set up (first run) and start the segmentation backend on port 5000.
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)

if not exist venv\Scripts\python.exe (
  echo First run: creating Python environment...
  %PY% -m venv venv
  if errorlevel 1 goto :fail
)

venv\Scripts\python -c "import flask, trimesh, scipy, fast_simplification" >nul 2>nul
if errorlevel 1 (
  echo Installing dependencies - this takes a minute or two...
  venv\Scripts\python -m pip install --upgrade pip
  venv\Scripts\python -m pip install -r requirements.txt
  if errorlevel 1 goto :fail
  echo Installing optional accelerators - it is OK if this part fails...
  venv\Scripts\python -m pip install -r requirements-optional.txt
)

echo.
echo Starting backend on http://127.0.0.1:5000  (leave this window open)
venv\Scripts\python app.py
echo.
echo Backend stopped.
pause
exit /b

:fail
echo.
echo Setup failed. Things to check:
echo  - Python 3.10 or newer must be installed (python.org, tick "Add to PATH")
echo  - If a previous attempt half-finished, delete the backend\venv folder and rerun
pause
exit /b 1
