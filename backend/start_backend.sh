#!/usr/bin/env bash
# Set up (first run) and start the segmentation backend on :5000.
set -e
cd "$(dirname "$0")"
if [ ! -d venv ]; then
  echo "First run: creating venv and installing dependencies..."
  python3 -m venv venv
  venv/bin/pip install -r requirements.txt
fi
exec venv/bin/python app.py
