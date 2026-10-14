$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$releasePath = Join-Path $projectPath 'releases'
New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
$releaseFiles = @('public','docs','tools','tests','README.md','CHANGELOG.md','THIRD_PARTY.md','VERIFICATION.md','start-local.cmd','start-local.ps1','stop-local.cmd','stop-local.ps1')
$fullPaths = $releaseFiles | ForEach-Object { Join-Path $projectPath $_ }
Compress-Archive -LiteralPath $fullPaths -DestinationPath (Join-Path $releasePath 'signature-studio-v1.1.0-full.zip') -Force
# Обновление веб-интерфейса: существующие файлы заменяются готовым комплектом.
$updatePaths = @('public','docs','README.md','CHANGELOG.md','THIRD_PARTY.md','VERIFICATION.md') | ForEach-Object { Join-Path $projectPath $_ }
Compress-Archive -LiteralPath $updatePaths -DestinationPath (Join-Path $releasePath 'signature-studio-v1.1.0-update.zip') -Force
Get-FileHash -LiteralPath (Join-Path $releasePath 'signature-studio-v1.1.0-full.zip'),(Join-Path $releasePath 'signature-studio-v1.1.0-update.zip') -Algorithm SHA256 | ForEach-Object { "$($_.Hash)  $([IO.Path]::GetFileName($_.Path))" } | Set-Content -LiteralPath (Join-Path $releasePath 'SHA256.txt') -Encoding ascii
