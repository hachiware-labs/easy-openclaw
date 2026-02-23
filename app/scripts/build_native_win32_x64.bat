@echo off
setlocal

cd /d "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

call npm run -s tauri -- build --target x86_64-pc-windows-msvc --bundles none
if errorlevel 1 exit /b %errorlevel%

node .\scripts\package_native.mjs win32-x64 src-tauri\target\x86_64-pc-windows-msvc\release\easyclaw.exe
if errorlevel 1 exit /b %errorlevel%

echo Windows x64 native package staged at bin\native\win32-x64\easyclaw.exe
exit /b 0
