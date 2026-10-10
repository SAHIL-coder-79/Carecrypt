@echo off
echo Starting CareCrypt Servers...

echo [1/2] Starting Backend...
start "CareCrypt Backend" cmd /k "cd backend && npm run dev"

echo [2/2] Starting Frontend...
start "CareCrypt Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are launching in separate windows!
echo - Backend API: http://localhost:4000
echo - Frontend Web: http://localhost:5173
echo.
echo You can close this window now. The servers will continue running in their own windows.
pause
