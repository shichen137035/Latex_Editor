@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title TeXWeave - Local LaTeX Editor

echo ========================================
echo        TeXWeave Local LaTeX Editor
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :node_missing

where npm >nul 2>nul
if errorlevel 1 goto :npm_missing

echo Node.js:
node --version
echo.

if not exist "node_modules\electron\package.json" (
    echo Dependencies are missing. Installing with npm install...
    echo.
    call npm install
    if errorlevel 1 goto :install_failed
    echo.
)

echo Starting TeXWeave...
echo Close this window after the application exits.
echo.
call npm run desktop:dev
if errorlevel 1 goto :start_failed

echo.
echo TeXWeave has exited.
pause
exit /b 0

:node_missing
echo [ERROR] Node.js was not found on PATH.
echo Please install Node.js 22 or newer, then double-click this file again.
pause
exit /b 1

:npm_missing
echo [ERROR] npm was not found on PATH.
echo Please repair the Node.js installation or add npm to PATH.
pause
exit /b 1

:install_failed
echo [ERROR] Dependency installation failed.
echo Check your network connection and npm output above, then try again.
pause
exit /b 1

:start_failed
echo [ERROR] TeXWeave failed to start.
echo Check the output above for details.
pause
exit /b 1
