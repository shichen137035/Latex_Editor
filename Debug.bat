@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title TeXWeave - Debug Launch

where node >nul 2>nul
if errorlevel 1 goto :node_missing

node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 goto :node_old

if not exist "node_modules\electron\package.json" goto :dependencies_missing
if not exist "node_modules\vite\package.json" goto :dependencies_missing
if not exist "node_modules\typescript\bin\tsc" goto :dependencies_missing
if not exist "node_modules\esbuild\package.json" goto :dependencies_missing

echo Starting TeXWeave in development mode with renderer hot reload...
echo Renderer changes update live. Main-process changes rebuild and restart Electron.
echo.
node apps\desktop\scripts\dev.cjs
if errorlevel 1 goto :launch_failed

echo.
echo TeXWeave has exited.
pause
exit /b 0

:node_missing
echo [ERROR] Node.js was not found on PATH.
pause
exit /b 1

:node_old
echo [ERROR] Node.js 22 or newer is required.
pause
exit /b 1

:dependencies_missing
echo [ERROR] Electron dependencies are missing. Run npm install first.
pause
exit /b 1

:launch_failed
echo [ERROR] TeXWeave failed to launch. Check the output above.
pause
exit /b 1
