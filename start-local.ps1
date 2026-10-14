param([string]$PhpPath = '', [int]$Port = 8787, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Укажите порт от 1024 до 65535.' }
if (-not $PhpPath) {
    $phpCommand = Get-Command php.exe -ErrorAction SilentlyContinue
    if ($phpCommand) { $PhpPath = $phpCommand.Source }
    else {
        foreach ($candidate in @('C:\xampp\php\php.exe', 'C:\laragon\bin\php\php.exe')) {
            if (Test-Path -LiteralPath $candidate) { $PhpPath = $candidate; break }
        }
    }
}
if (-not $PhpPath -or -not (Test-Path -LiteralPath $PhpPath -PathType Leaf)) { throw 'PHP не найден. Укажите путь: .\start-local.ps1 -PhpPath "C:\путь\php.exe"' }
$publicPath = Join-Path $PSScriptRoot 'public'
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)" -ErrorAction SilentlyContinue
    if ($running -and $running.Name -eq 'php.exe' -and $running.CommandLine.Contains($publicPath) -and $running.CommandLine.Contains("127.0.0.1:$Port")) {
        Set-Content -LiteralPath (Join-Path $PSScriptRoot '.local-server.pid') -Value $running.ProcessId -Encoding ascii
        Write-Host "Утилита уже запущена: http://127.0.0.1:$Port"
        if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
        exit
    }
    throw "Порт $Port уже занят. Используйте -Port с другим номером."
}
$process = Start-Process -FilePath $PhpPath -ArgumentList @('-d', 'file_uploads=Off', '-d', 'enable_post_data_reading=Off', '-S', "127.0.0.1:$Port", '-t', ('"' + $publicPath + '"')) -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 500
if ($process.HasExited) { throw 'Локальный сервер не запустился. Проверьте путь PHP и свободный порт.' }
Set-Content -LiteralPath (Join-Path $PSScriptRoot '.local-server.pid') -Value $process.Id -Encoding ascii
Write-Host "Локальная подпись: http://127.0.0.1:$Port"
Write-Host 'Остановка: stop-local.ps1'
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port" }
