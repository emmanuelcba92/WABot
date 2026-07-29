@echo off
title Conector WA Bot - Clínica Médica
color 0A
echo ============================================================
echo   INICIANDO CONECTOR DE WHATSAPP WEB - CLÍNICA MÉDICA
echo ============================================================
echo.
cd /d "%~dp0"

if not exist "node_modules\" (
    echo [!] Instalando dependencias necesarias por primera vez...
    call npm.cmd install
    echo [OK] Instalacion completada con exito.
    echo.
)

call npm.cmd start
pause
