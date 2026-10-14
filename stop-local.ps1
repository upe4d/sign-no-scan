$ErrorActionPreference = 'Stop'
$pidPath = Join-Path $PSScriptRoot '.local-server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Host 'Нет сохранённого локального сервера.'; exit }
$serverId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$serverId)) { throw 'Повреждён номер процесса сервера.' }
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$serverId" -ErrorAction SilentlyContinue
$publicPath = Join-Path $PSScriptRoot 'public'
if ($process) {
    if ($process.Name -ne 'php.exe' -or -not $process.CommandLine.Contains($publicPath) -or -not $process.CommandLine.Contains('127.0.0.1:')) { throw 'Номер процесса уже принадлежит другому приложению. Остановка отменена.' }
    Stop-Process -Id $serverId
}
Remove-Item -LiteralPath $pidPath
Write-Host 'Локальный сервер остановлен.'
