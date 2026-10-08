@echo off
rem Double-click me to set up video-studio. Runs setup-video-studio.ps1 from this folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-video-studio.ps1" %*
