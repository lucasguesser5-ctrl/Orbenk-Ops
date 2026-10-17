@echo off
title ORBENK OPS - Inicializador do Sistema
chcp 65001 >nul
cls

echo ===================================================================
echo     ORBENK OPS - SISTEMA OPERACIONAL TÁTICO DE OCORRÊNCIAS
echo ===================================================================
echo.
echo  Iniciando sistema portatil...
echo  (Nao e necessario instalar Python nem programas adicionais)
echo.
echo  Aguarde 2 segundos... seu navegador abrira automaticamente!
echo.
echo ===================================================================

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"

if %errorlevel% neq 0 (
    echo.
    echo Ocorreu um erro ao iniciar o PowerShell.
    pause
)
