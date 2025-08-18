@echo off
echo 🎯 Starting Optimized 3D Miniature Painter...

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python not found. Please install Python 3.7+ and try again.
    pause
    exit /b 1
)

REM Check if Node.js is available
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js not found. Please install Node.js and try again.
    pause
    exit /b 1
)

echo ✅ Python and Node.js found

REM Install backend dependencies if needed
if not exist "backend\venv" (
    echo 📦 Setting up Python virtual environment...
    cd backend
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
    cd ..
) else (
    echo ✅ Python virtual environment exists
)

REM Install frontend dependencies if needed
if not exist "node_modules" (
    echo 📦 Installing frontend dependencies...
    npm install
) else (
    echo ✅ Frontend dependencies installed
)

echo 🚀 Starting backend server...
cd backend
call venv\Scripts\activate.bat
start "Backend Server" python app.py
cd ..

REM Wait for backend to start
echo ⏳ Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

echo 🌐 Starting frontend server...
start "Frontend Server" npm start

echo.
echo 🎯 Optimized 3D Miniature Painter is starting!
echo.
echo 📊 Research Features:
echo    • 8-12 semantic regions instead of 171+ abstract
echo    • Armor, weapon, cape, base detection
echo    • Height-based template assignment
echo    • RAG-based intelligent merging
echo.
echo 🌐 Access the app at: http://localhost:3000
echo 🤖 Backend API at: http://localhost:5000
echo.
echo Press any key to close this window (servers will continue running)
pause