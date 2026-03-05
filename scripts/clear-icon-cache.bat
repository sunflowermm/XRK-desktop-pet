@echo off
taskkill /f /im explorer.exe >nul 2>&1
del /a /q /f "%localappdata%\IconCache.db" >nul 2>&1
del /a /q /f "%localappdata%\Microsoft\Windows\Explorer\iconcache*.db" >nul 2>&1
del /a /q /f "%localappdata%\Microsoft\Windows\Explorer\thumbcache*.db" >nul 2>&1
start explorer.exe
