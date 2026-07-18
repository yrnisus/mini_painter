#!/usr/bin/env bash
# Launch the segmentation backend and the React frontend together.
set -e
cd "$(dirname "$0")"

if [ ! -d backend/venv ]; then
  echo "Setting up Python backend venv..."
  python3 -m venv backend/venv
  backend/venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Starting backend on :5000"
(cd backend && venv/bin/python app.py) &
BACKEND_PID=$!
trap "kill $BACKEND_PID 2>/dev/null" EXIT

echo "Starting frontend on :3000"
npm start
