@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title TeXWeave - Debug Launch

where node >nul 2>nul
if errorlevel 1 goto :node_missing

if not exist "node_modules\electron\package.json" goto :dependencies_missing
if not exist "apps\desktop\dist\main\index.js" goto :build_missing
if not exist "apps\desktop\dist\renderer\index.html" goto :build_missing

echo Starting the latest built TeXWeave app without rebuilding...
echo Source changes will appear after running: npm run desktop:build
echo.
call node apps\desktop\scripts\launch.cjs
if errorlevel 1 goto :launch_failed

echo.
echo TeXWeave has exited.
pause
exit /b 0

:node_missing
echo [ERROR] Node.js was not found on PATH.
pause
exit /b 1

:dependencies_missing
echo [ERROR] Electron dependencies are missing. Run npm install first.
pause
exit /b 1

:build_missing
echo [ERROR] TeXWeave has not been built yet.
echo Run npm run desktop:build once, then use Debug.bat for quick launches.
pause
exit /b 1

:launch_failed
echo [ERROR] TeXWeave failed to launch. Check the output above.
pause
exit /b 1
