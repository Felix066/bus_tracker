@echo off
echo Starting Bus Tracker App and Tunnel...
start "PHP Server" cmd /k "C:\xampp\php\php.exe -S localhost:8080"
start "Ngrok Tunnel" cmd /k "ngrok http 8080"
echo.
echo Both services are starting in new windows.
echo Please check the Ngrok window for your public URL.
pause
