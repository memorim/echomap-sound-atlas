@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22+: https://nodejs.org/& pause& exit /b 1)
where pnpm >nul 2>nul || call corepack enable
call pnpm install || pause
start "EchoMap" http://localhost:4700
call pnpm start
