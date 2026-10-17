@echo off
chcp 65001 >nul
title Orbenk Ops - Publicar no GitHub
color 0B

echo ================================================================================
echo               ORBENK OPS — ASSISTENTE DE PUBLICAÇÃO NO GITHUB
echo ================================================================================
echo.

where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [AVISO] O Git ainda não está instalado no seu computador.
    echo.
    echo Para instalar em 1 minuto:
    echo 1. Baixe o instalador oficial em: https://git-scm.com/download/win
    echo 2. Instale com as opções padrão.
    echo 3. Execute este arquivo novamente!
    echo.
    echo Pressione qualquer tecla para abrir o site do Git...
    pause >nul
    start https://git-scm.com/download/win
    exit /b
)

echo [1/4] Inicializando repositório Git local...
if not exist ".git" (
    git init
    git branch -M main
) else (
    echo       Repositório Git já inicializado.
)

echo.
echo [2/4] Adicionando todos os arquivos organizados...
git add .

echo.
echo [3/4] Criando commit inicial com documentação e estrutura completa...
git commit -m "feat: initial commit - Orbenk Ops v2.0 Tactical Incident Reporting System"

echo.
echo ================================================================================
echo                          CONFIGURAR REPOSITÓRIO REMOTO
echo ================================================================================
echo.
echo Crie um novo repositório vazio no GitHub:
echo   https://github.com/new
echo.
echo (Deixe o repositório VAZIO, sem marcar README, .gitignore ou License)
echo.
set /p REPO_URL="Cole aqui a URL do seu repositório GitHub (ex: https://github.com/usuario/orbenk-ops.git): "

if "%REPO_URL%"=="" (
    echo [!] Nenhuma URL informada. Os arquivos foram commitados localmente.
    echo Quando tiver a URL, rode:
    echo   git remote add origin SUA_URL
    echo   git push -u origin main
    echo.
    pause
    exit /b
)

git remote remove origin >nul 2>nul
git remote add origin %REPO_URL%

echo.
echo [4/4] Enviando código para a branch main do GitHub...
git push -u origin main

echo.
echo ================================================================================
echo                  PROJETO PUBLICADO COM SUCESSO NO GITHUB!
echo ================================================================================
pause
