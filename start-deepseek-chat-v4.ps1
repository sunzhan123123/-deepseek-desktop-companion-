param()

$ErrorActionPreference = 'Stop'
$companionOutput = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $companionOutput 'companion-paths.ps1')
$companionPaths = Get-CompanionPaths -PackageRoot $companionOutput
$companionData = $companionPaths.DataRoot
if (-not $companionData) { throw 'The Windows user profile could not be resolved. Start this launcher in a standard Windows user session.' }
$companionWallpaperLauncher = Join-Path $companionOutput 'start-deepseek-wallpaper-v3.ps1'
if (-not (Test-Path -LiteralPath $companionWallpaperLauncher -PathType Leaf)) { throw 'The desktop wallpaper launcher is missing. Extract the complete companion package into one directory.' }
$companionEdge = $companionPaths.EdgeExe
Assert-CompanionExecutable $companionEdge 'Microsoft Edge' 'edgeExe'

# Reuse the desktop's existing room; if it is stopped, mount it through Lively.
# This path never opens a standalone /room browser window.
& $companionWallpaperLauncher -NoChat
$companionSaved = Get-Content -LiteralPath (Join-Path $companionData 'desktop-launch.json') -Raw | ConvertFrom-Json
$companionUri = $null
if (-not [Uri]::TryCreate([string]$companionSaved.url, [UriKind]::Absolute, [ref]$companionUri) -or $companionUri.Scheme -ne 'http' -or $companionUri.Host -ne '127.0.0.1' -or $companionUri.Port -notin (17865..17869)) { throw 'The saved service URL is invalid. Start the companion desktop wallpaper again.' }
$companionUrl = $companionUri.GetLeftPart([UriPartial]::Authority)
$companionReadyDeadline = (Get-Date).ToUniversalTime().AddSeconds(45)
$companionRuntimeReady = $false
do {
    $companionRemaining = $companionReadyDeadline - (Get-Date).ToUniversalTime()
    # Leave enough budget for the whole one-second HTTP timeout. The final
    # fractional second can wait, but must not start another over-budget poll.
    if ($companionRemaining.TotalMilliseconds -lt 1000) {
        if ($companionRemaining.TotalMilliseconds -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Ceiling($companionRemaining.TotalMilliseconds)) }
        break
    }
    $companionReadyState = $null
    try { $companionReadyState = Invoke-RestMethod -Uri ($companionUrl + '/api/state') -TimeoutSec 1 } catch { }
    if ($companionReadyState) {
        if ($companionReadyState.appId -ne 'deepseek-wallpaper-companion-v1') { throw '本地聊天服务标识不匹配，请重新启动桌面助手。' }
        if ($companionReadyState.runtime.state -eq 'ready') { $companionRuntimeReady = $true; break }
        if ($companionReadyState.runtime.state -eq 'error') {
            $companionPublicError = [string]$companionReadyState.runtime.error
            if ([string]::IsNullOrWhiteSpace($companionPublicError)) { $companionPublicError = '聊天服务暂时不可用，请重启后再试。' }
            throw $companionPublicError
        }
    }
    $companionRemaining = $companionReadyDeadline - (Get-Date).ToUniversalTime()
    if ($companionRemaining.TotalMilliseconds -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Min(500, [Math]::Ceiling($companionRemaining.TotalMilliseconds))) }
} while ((Get-Date).ToUniversalTime() -lt $companionReadyDeadline)
if (-not $companionRuntimeReady) { throw '聊天服务仍未就绪，等待已超时，请稍后重试。' }
Start-Process -FilePath $companionEdge -ArgumentList @(('--app=' + $companionUrl + '/chat'), '--window-size=460,780', '--no-first-run') | Out-Null
Write-Output ('DeepSeek chat opened and connected to the existing conversation: ' + $companionUrl + '/chat')
