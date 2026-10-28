param(
    [Parameter(Mandatory = $true)]
    [string]$Binary
)

$ErrorActionPreference = 'Stop'
$upxPath = Join-Path $PSScriptRoot '..\upx-5.2.1-win64\upx.exe'
$upxPath = [System.IO.Path]::GetFullPath($upxPath)
$binaryPath = [System.IO.Path]::GetFullPath($Binary)

if (-not (Test-Path -LiteralPath $upxPath -PathType Leaf)) {
    throw "UPX executable was not found: $upxPath"
}
if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
    throw "Build output executable was not found: $binaryPath"
}

& $upxPath -9 $binaryPath
if ($LASTEXITCODE -ne 0) {
    throw "UPX failed with exit code $LASTEXITCODE"
}
