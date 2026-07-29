@echo off
title Conector WA Bot - Clínica Médica
color 0A
echo ============================================================
echo   INICIANDO CONECTOR DE WHATSAPP WEB - CLÍNICA MÉDICA
echo ============================================================
echo.
cd /d "%~dp0"
call npm.cmd start
pause
