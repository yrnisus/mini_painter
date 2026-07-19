#!/usr/bin/env bash
# Set up (first run) and start the segmentation backend on port 5000.
set -e
cd "$(dirname "$0")"

if [ ! -x venv/bin/python ]; then
  echo "First run: creating Python environment..."
  python3 -m venv venv
fi

if ! venv/bin/python -c "import flask, trimesh, scipy, fast_simplification" 2>/dev/null; then
  echo "Installing dependencies — this takes a minute or two..."
  venv/bin/python -m pip install --upgrade pip
  venv/bin/python -m pip install -r requirements.txt
  echo "Installing optional accelerators (it's OK if this part fails)..."
  venv/bin/python -m pip install -r requirements-optional.txt || true
fi

echo "Starting backend on http://127.0.0.1:5000 (leave this terminal open)"
exec venv/bin/python app.py
