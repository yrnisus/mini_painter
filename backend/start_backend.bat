@echo off
rem Set up (first run) and start the segmentation backend on :5000.
cd /d "%~dp0"
if not exist venv (
  echo First run: creating venv and installing dependencies...
  py -3 -m venv venv || python -m venv venv
  venv\Scripts\pip install -r requirements.txt
)
venv\Scripts\python app.py
