@echo off
rem Copies the newest server backup to THIS computer, so a failure of the server never loses your business.
rem Edit the two lines below, then double-click this file (or run it from cmd) once a week — or schedule it with Windows Task Scheduler.
set SERVER=root@YOUR.SERVER.IP.ADDRESS
set DEST=C:\sokoni-offsite-backups
if not exist "%DEST%" mkdir "%DEST%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%i
scp %SERVER%:/var/backups/sokoni/latest.tar.gz "%DEST%\sokoni-%TODAY%.tar.gz"
if errorlevel 1 (echo FAILED - the backup was not copied) else (echo Saved %DEST%\sokoni-%TODAY%.tar.gz)
echo This file contains customer data and documents: keep it somewhere private (an encrypted drive).
pause
