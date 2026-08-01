@echo off
title Conector WA Bot - Clínica COAT (Auto-Reiniciable)
color 0A
cd /d "%~dp0"

:loop
echo ============================================================
echo   INICIANDO CONECTOR DE WHATSAPP WEB - CLÍNICA COAT
echo ============================================================
echo.

if not exist "node_modules\" (
    echo [!] Instalando dependencias necesarias por primera vez...
    call npm.cmd install
    echo [OK] Instalación completada con éxito.
    echo.
)

call npm.cmd start

echo.
echo ============================================================
echo ⚠️ [ATENCIÓN] El conector de WhatsApp se detuvo.
echo 🔄 Reiniciando automáticamente en 5 segundos... (No cierres esta ventana)
echo 📄 Consulta los errores grabados en: bot_errors.log
echo ============================================================
echo.
timeout /t 5
goto loop
