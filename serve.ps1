# ==============================================================================
# ORBENK OPS — Servidor Portatil Nativo de Alta Compatibilidade
# Funciona em qualquer Windows 10/11 sem instalar nada (Zero Instalacao)
# ==============================================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$root = Join-Path $scriptDir "frontend"
if (-not (Test-Path $root)) { $root = $scriptDir }

# Selecao automatica de porta livre
$ports = @(8080, 8081, 8082, 8085, 8888, 9090)
$port = 8080
$listener = $null

foreach ($p in $ports) {
    try {
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add("http://localhost:$p/")
        $l.Start()
        $listener = $l
        $port = $p
        break
    } catch {
        # Porta ocupada, tenta a proxima
    }
}

if (-not $listener) {
    Write-Host "Nao foi possivel abrir o servidor nas portas padroes." -ForegroundColor Red
    Pause
    exit 1
}

$url = "http://localhost:$port/index.html"
Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "   ORBENK OPS — SISTEMA OPERACIONAL TATICO DE OCORRENCIAS" -ForegroundColor White
Write-Host "   Servidor portatil ativo em: $url" -ForegroundColor Green
Write-Host "   Pressione Ctrl+C para encerrar o sistema." -ForegroundColor Yellow
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

Start-Process $url

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

try {
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response

            $path = $request.Url.LocalPath.TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($path) -or $path -eq "/") { $path = "index.html" }

            $localPath = Join-Path $root $path

            if (Test-Path $localPath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
                $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
                $bytes = [System.IO.File]::ReadAllBytes($localPath)

                $response.ContentType = $contentType
                $response.ContentLength64 = $bytes.Length
                $response.AddHeader("Access-Control-Allow-Origin", "*")
                $response.AddHeader("Cache-Control", "no-cache")
                if ($request.HttpMethod -ne 'HEAD') {
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } else {
                $response.StatusCode = 404
                $err = [System.Text.Encoding]::UTF8.GetBytes("404 - Not Found")
                $response.ContentLength64 = $err.Length
                if ($request.HttpMethod -ne 'HEAD') {
                    $response.OutputStream.Write($err, 0, $err.Length)
                }
            }
            $response.Close()
        } catch {
            # Mantem o loop ativo mesmo em falhas pontuais de conexao
        }
    }
} finally {
    if ($listener) { $listener.Stop() }
}
