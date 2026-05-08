@echo off
title C Code Assistant
echo.
echo ==========================================
echo    C Code Assistant - Starting...
echo ==========================================
echo.

:: Find Python
where python >nul 2>&1
if %errorlevel% == 0 ( set PYTHON=python & goto :found )
where py >nul 2>&1
if %errorlevel% == 0 ( set PYTHON=py & goto :found )
echo ERROR: Python not found. Install from https://python.org
pause & exit /b 1

:found
echo [OK] Python: & %PYTHON% --version

:: Fix pip if missing
%PYTHON% -m pip --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [..] Installing pip...
    %PYTHON% -m ensurepip --upgrade 2>nul || (
        curl -sSL https://bootstrap.pypa.io/get-pip.py -o "%TEMP%\get-pip.py"
        %PYTHON% "%TEMP%\get-pip.py" --quiet
    )
)

:: Install dependencies
echo [..] Checking dependencies...
%PYTHON% -m pip install flask flask-cors requests --quiet
if %errorlevel% neq 0 (
    echo ERROR: Could not install dependencies.
    pause & exit /b 1
)
echo [OK] Dependencies ready

:: Kill anything on port 5050
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5050 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo ==========================================
echo  Starting server on http://localhost:5050
echo.
echo  Make sure Ollama is running in another
echo  window:   ollama serve
echo  (No special flags needed)
echo ==========================================
echo.

cd /d "%~dp0"
%PYTHON% server.py
pause
