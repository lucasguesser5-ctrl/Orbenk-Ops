# ORBENK OPS — Inicializador portátil (sem dependências)
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'frontend'
$Host.UI.RawUI.WindowTitle = 'ORBENK OPS — Servidor Local (feche esta janela para encerrar)'

# 1) Se o sistema já estiver rodando, apenas abre o navegador
foreach ($p in 8080, 8088, 8090) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$p/index.html" -UseBasicParsing -TimeoutSec 2
        if ($r.Content -match 'ORBENK') {
            Start-Process "http://localhost:$p/index.html"
            exit
        }
    } catch {}
}

# 2) Caso contrário, sobe o servidor na primeira porta livre
$listener = $null
foreach ($p in 8080, 8088, 8090) {
    try {
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add("http://localhost:$p/")
        $l.Start()
        $listener = $l; $port = $p; break
    } catch {}
}
if (-not $listener) {
    Write-Host 'Nao foi possivel iniciar o servidor (portas 8080/8088/8090 ocupadas).' -ForegroundColor Red
    Read-Host 'Pressione ENTER para sair'; exit 1
}

$url = "http://localhost:$port/index.html"
Write-Host ''
Write-Host '  ORBENK OPS — SISTEMA INTEGRADO DE OCORRENCIAS' -ForegroundColor Cyan
Write-Host "  Servidor ativo em: $url" -ForegroundColor Green
Write-Host '  Login: admin   |   Senha: Link2026@'
Write-Host '  Feche esta janela para encerrar o sistema.'
Start-Process $url

$mime = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
           '.json'='application/json; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.ico'='image/x-icon' }
try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext(); $res = $ctx.Response
        try {
            $path = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath.TrimStart('/'))
            if ([string]::IsNullOrWhiteSpace($path)) { $path = 'index.html' }
            $file = Join-Path $root $path
            if (Test-Path $file -PathType Leaf) {
                $ext = [IO.Path]::GetExtension($file).ToLower()
                $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
                $bytes = [IO.File]::ReadAllBytes($file)
            } else {
                $res.StatusCode = 404; $bytes = [Text.Encoding]::UTF8.GetBytes('404 - Nao encontrado')
            }
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {} finally { $res.Close() }
    }
} finally { $listener.Stop() }
