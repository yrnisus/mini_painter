@echo off
echo Setting up 3D Miniature Painter Backend...

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Create backend directory
if not exist backend mkdir backend
cd backend

:: Create virtual environment
echo Creating virtual environment...
python -m venv sam_env

:: Activate virtual environment
echo Activating virtual environment...
call sam_env\Scripts\activate.bat

:: Create requirements.txt
echo Creating requirements.txt...
(
echo torch^>=1.9.0
echo torchvision^>=0.10.0
echo opencv-python^>=4.5.0
echo numpy^>=1.21.0
echo Pillow^>=8.3.0
echo flask^>=2.0.0
echo flask-cors^>=3.0.0
echo segment-anything @ git+https://github.com/facebookresearch/segment-anything.git
echo trimesh^>=3.9.0
echo matplotlib^>=3.5.0
echo scikit-image^>=0.18.0
echo scikit-learn^>=1.0.0
) > requirements.txt

:: Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

:: Install dependencies
echo Installing dependencies...
pip install -r requirements.txt

:: Download SAM model (smallest one first)
echo Downloading SAM model checkpoint...
if not exist sam_vit_b_01ec64.pth (
    echo Downloading ViT-B model (350MB)...
    curl -L -o sam_vit_b_01ec64.pth https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
)

echo.
echo Backend setup complete!
echo.
echo To start the backend server:
echo 1. cd backend
echo 2. sam_env\Scripts\activate
echo 3. python app.py
echo.
pause