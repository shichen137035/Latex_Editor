@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title TeXWeave - Build Windows NSIS Installer

echo ========================================
echo      TeXWeave Windows NSIS Installer Build
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :node_missing
where npm >nul 2>nul
if errorlevel 1 goto :npm_missing

node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 goto :node_old

echo Node.js:
node --version
echo.

if not exist "node_modules\electron\package.json" goto :install_dependencies
if not exist "node_modules\electron-builder\cli.js" goto :install_dependencies
if not exist "node_modules\typescript\bin\tsc" goto :install_dependencies
goto :build

:install_dependencies
echo Installing locked dependencies with npm ci...
echo.
call npm ci
if errorlevel 1 goto :install_failed
echo.

:build
echo Rebuilding source, checking packaged startup, and creating the NSIS installer...
echo Compression may take a few minutes without new output.
echo.
call npm run desktop:package:nsis -- %*
if errorlevel 1 goto :build_failed

echo.
echo [SUCCESS] The Windows NSIS installer build is ready.
echo The executable path is printed above.
echo See release\latest-nsis.json for the latest successful output folder.
pause
exit /b 0

:node_missing
echo [ERROR] Node.js was not found on PATH.
echo Install Node.js 22 or newer, then double-click this file again.
pause
exit /b 1

:node_old
echo [ERROR] Node.js 22 or newer is required.
pause
exit /b 1

:npm_missing
echo [ERROR] npm was not found on PATH. Repair the Node.js installation.
pause
exit /b 1

:install_failed
echo [ERROR] Dependency installation failed. Check the output above.
pause
exit /b 1

:build_failed
echo [ERROR] Build or package verification failed. Check the output above.
pause
exit /b 1
