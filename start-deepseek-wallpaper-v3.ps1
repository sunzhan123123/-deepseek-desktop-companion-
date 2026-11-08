param([switch]$NoChat)

$ErrorActionPreference = 'Stop'
$companionOutput = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $companionOutput 'companion-paths.ps1')
$companionPaths = Get-CompanionPaths -PackageRoot $companionOutput
$companionData = $companionPaths.DataRoot
if (-not $companionData) { throw 'The Windows user profile could not be resolved. Start this launcher in a standard Windows user session.' }
$companionLively = $companionPaths.LivelyExe
if (-not $companionPaths.LivelyDataRoot -or -not $companionPaths.LivelyLibraryRoot) { throw 'Lively data paths could not be resolved. Set livelyDataRoot and livelyLibraryRoot in companion-settings.local.json.' }
$companionLibrary = $companionPaths.LivelyLibraryRoot
$companionProject = Join-Path $companionLibrary 'wallpapers/deepseek-room-v3'
$companionLayoutFile = Join-Path $companionPaths.LivelyDataRoot 'WallpaperLayout.json'
$companionBackendLauncher = Join-Path $companionOutput 'start-deepseek-chat-v1.ps1'
$companionMarker = Join-Path $companionData 'desktop-wallpaper-v3.json'

function Test-CompanionProjectPath($Path) {
    if (-not $Path) { return $false }
    try {
        return [IO.Path]::GetFullPath([string]$Path).TrimEnd('\','/').Equals([IO.Path]::GetFullPath($companionProject).TrimEnd('\','/'), [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

Assert-CompanionExecutable $companionLively 'Lively Wallpaper (tested version 2.2.1.0)' 'livelyExe'
if (-not (Test-Path -LiteralPath $companionBackendLauncher -PathType Leaf)) { throw 'The companion backend launcher is missing. Extract the complete companion package into one directory, then try again.' }
if (-not $NoChat) {
    $companionEdge = $companionPaths.EdgeExe
    Assert-CompanionExecutable $companionEdge 'Microsoft Edge' 'edgeExe'
}

& $companionBackendLauncher -NoWindows
$companionLaunchRecord = Join-Path $companionData 'desktop-launch.json'
if (-not (Test-Path -LiteralPath $companionLaunchRecord -PathType Leaf)) { throw 'The local service did not create desktop-launch.json. Check the companion server log in %USERPROFILE%\.deepseek-wallpaper-companion.' }
$companionSaved = Get-Content -LiteralPath $companionLaunchRecord -Raw | ConvertFrom-Json
$companionUri = $null
if (-not [Uri]::TryCreate([string]$companionSaved.url, [UriKind]::Absolute, [ref]$companionUri) -or $companionUri.Scheme -ne 'http' -or $companionUri.Host -ne '127.0.0.1' -or $companionUri.Port -notin (17865..17869)) { throw 'The saved service URL is invalid. Start the companion local service again.' }
$companionUrl = $companionUri.GetLeftPart([UriPartial]::Authority)
$companionState = Invoke-RestMethod -Uri ($companionUrl + '/api/state') -TimeoutSec 2
if ($companionState.appId -ne 'deepseek-wallpaper-companion-v1') { throw 'The selected local port belongs to another application.' }
$companionHostWasRunning = [bool](Get-Process -Name Lively -ErrorAction SilentlyContinue)

$companionLayout = @()
if (Test-Path -LiteralPath $companionLayoutFile -PathType Leaf) {
    $companionParsedLayout = Get-Content -LiteralPath $companionLayoutFile -Raw | ConvertFrom-Json
    $companionLayout = @($companionParsedLayout)
}
$companionOwned = @($companionLayout | Where-Object { Test-CompanionProjectPath $_.LivelyInfoPath })
if ($companionOwned.Count -gt 1 -or ($companionOwned.Count -eq 1 -and $companionOwned[0].LivelyScreen.IsPrimary -ne $true)) { throw 'This companion room is mounted on a non-primary or multiple monitors. Close its extra wallpapers in Lively, then launch it on the primary display.' }
if (($companionOwned.Count -eq 0 -or -not $companionHostWasRunning) -and $companionState.room.connected) { throw 'A companion room is already connected outside this desktop wallpaper. Close its standalone room window before starting the desktop wallpaper.' }

if ($companionOwned.Count -eq 0 -or -not $companionHostWasRunning) {
    New-Item -ItemType Directory -Path $companionProject -Force | Out-Null
    @{
        AppVersion='2.2.1.0';Title='DeepSeek Desktop Room';Thumbnail=$null;Preview=$null;Desc='Interactive local companion room; open the independent chat with the companion launcher.';
        Author='Local companion';License=$null;Contact=$null;Type=3;FileName=($companionUrl + '/room');Arguments=$null;IsAbsolutePath=$false
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $companionProject 'LivelyInfo.json') -Encoding UTF8

} elseif (Test-Path -LiteralPath (Join-Path $companionProject 'LivelyInfo.json') -PathType Leaf) {
    $companionProjectInfo = Get-Content -LiteralPath (Join-Path $companionProject 'LivelyInfo.json') -Raw | ConvertFrom-Json
    if ($companionProjectInfo.FileName -ne ($companionUrl + '/room')) { throw 'The active desktop room points to a different service port. Run stop-deepseek-wallpaper-v3.cmd, then start it again to reconnect safely.' }
}

if (-not $companionHostWasRunning) {
    # One compatibility bootstrap per companion profile, with an exact backup.
    # Only WebBrowser may replace an existing preference; other defaults fill
    # missing keys. Discovery/check-environment never executes this function.
    $companionBootstrapMarker = Join-Path $companionData 'lively-bootstrap-v1.json'
    Initialize-CompanionLivelySettings -SettingsPath (Join-Path $companionPaths.LivelyDataRoot 'Settings.json') -LibraryRoot $companionLibrary -MarkerPath $companionBootstrapMarker | Out-Null

    # Saved layouts are restored by Lively itself. Prepare the URL before
    # starting it, then let that restore complete without sending setwp again.
    $companionHost = Start-Process -FilePath $companionLively -ArgumentList @('--showApp', 'false') -WindowStyle Hidden -PassThru
    if ($companionHost.HasExited -and $companionHost.ExitCode -ne 0) { throw 'Lively exited during startup. Open Lively once to finish WebView2 initialization, close its window, and try again.' }
}
if ($companionOwned.Count -eq 0) {
    # Official Lively v2.2.1.0 Constants.SingleInstance.GrpcPipeServerName.
    # A running process alone does not mean its command server is initialized.
    $companionHostPipe = '\\.\pipe\Grpc_LIVELY:DESKTOPWALLPAPERSYSTEM' + [Environment]::UserName
    $companionHostDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $companionHostPipe)) {
        if ([DateTime]::UtcNow -ge $companionHostDeadline) { throw 'Lively did not initialize its command server within 20 seconds. Open Lively once to finish setup and check WebView2, then try again.' }
        Start-Sleep -Milliseconds 250
    }
    $companionMount = Start-Process -FilePath $companionLively -ArgumentList @('setwp', '--file', ('"' + $companionProject + '"')) -WindowStyle Hidden -Wait -PassThru
    if ($companionMount.ExitCode -ne 0) { throw ('Lively rejected the desktop wallpaper command (exit ' + $companionMount.ExitCode + '). Open Lively once and check its WebView2 installation, then try again.') }
}

$companionDeadline = [DateTime]::UtcNow.AddSeconds(45)
$companionConnected = $false
do {
    try {
        $companionState = Invoke-RestMethod -Uri ($companionUrl + '/api/state') -TimeoutSec 2
        if ($companionState.appId -eq 'deepseek-wallpaper-companion-v1' -and $companionState.room.connected) { $companionConnected = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $companionDeadline)
if (-not $companionConnected) { throw 'Lively did not connect the desktop room within 45 seconds. Open Lively and confirm WebView2 is installed and DeepSeek Desktop Room is active; check %USERPROFILE%\.deepseek-wallpaper-companion\server.stderr.log. The wallpaper was not reported as ready.' }

@{enabled=$true;projectPath=$companionProject;serviceUrl=$companionUrl;livelyExe=$companionLively;mountedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $companionMarker -Encoding UTF8
if (-not $NoChat) {
    Start-Process -FilePath $companionEdge -ArgumentList @(('--app=' + $companionUrl + '/chat'), '--window-size=460,780', '--no-first-run') | Out-Null
    Write-Output ('DeepSeek desktop wallpaper connected; chat opened: ' + $companionUrl + '/chat')
} else {
    Write-Output ('DeepSeek desktop wallpaper connected: ' + $companionUrl + '/room')
}
