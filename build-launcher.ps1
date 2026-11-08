param()
$ErrorActionPreference = 'Stop'
$windowsDirectory = [Environment]::GetFolderPath('Windows')
$compiler = @('Microsoft.NET/Framework64/v4.0.30319/csc.exe','Microsoft.NET/Framework/v4.0.30319/csc.exe') | ForEach-Object { Join-Path $windowsDirectory $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) { throw 'The Windows .NET Framework 4 C# compiler was not found. Install the build prerequisite manually.' }
$source = Join-Path $PSScriptRoot 'deepseek-launcher-v4.cs'
$destination = Join-Path $PSScriptRoot 'deepseek-launcher-v4.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ ('/out:' + $destination) /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll $source
if ($LASTEXITCODE -ne 0) { throw ('Launcher compilation failed with exit code ' + $LASTEXITCODE) }
Write-Output ('Launcher rebuilt from source: ' + $destination)
