param([switch]$NoWindows)

$ErrorActionPreference = 'Stop'
$companionOutput = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $companionOutput 'companion-paths.ps1')
$companionPaths = Get-CompanionPaths -PackageRoot $companionOutput
$companionData = $companionPaths.DataRoot
if (-not $companionData) { throw 'The Windows user profile could not be resolved. Start this launcher in a standard Windows user session.' }
if (-not $NoWindows) {
    $companionDesktopMarker = Join-Path $companionData 'desktop-wallpaper-v3.json'
    $companionDesktopLauncher = Join-Path $companionOutput 'start-deepseek-wallpaper-v3.ps1'
    if ((Test-Path -LiteralPath $companionDesktopMarker) -and (Test-Path -LiteralPath $companionDesktopLauncher)) {
        $companionDesktopSettings = Get-Content -LiteralPath $companionDesktopMarker -Raw | ConvertFrom-Json
        if ($companionDesktopSettings.enabled -eq $true) {
            & $companionDesktopLauncher
            return
        }
    }
}
$companionScript = Join-Path $companionOutput 'deepseek-companion-server-v1.mjs'
$companionNode = $companionPaths.NodeExe
Assert-CompanionExecutable $companionNode 'Node.js' 'nodeExe'
if (-not $NoWindows) {
    $companionEdge = $companionPaths.EdgeExe
    Assert-CompanionExecutable $companionEdge 'Microsoft Edge' 'edgeExe'
}
New-Item -ItemType Directory -Path $companionData -Force | Out-Null
$companionUrl = $null
$companionSnapshot = $null
$companionPid = $null
foreach ($companionPort in 17865..17869) {
    $candidateUrl = 'http://127.0.0.1:' + $companionPort
    try {
        $candidateState = Invoke-RestMethod -Uri ($candidateUrl + '/api/state') -TimeoutSec 2
        if ($candidateState.appId -eq 'deepseek-wallpaper-companion-v1') {
            $companionUrl = $candidateUrl
            $companionSnapshot = $candidateState
            break
        }
    } catch { }
}
# Search the full reserved range before starting a new backend. A previous
# instance may still own a later port after an earlier port becomes free.
if (-not $companionUrl) {
foreach ($companionPort in 17865..17869) {
    $candidateUrl = 'http://127.0.0.1:' + $companionPort
    $companionProbe = New-Object System.Net.Sockets.TcpClient
    try { $companionOccupied = $companionProbe.ConnectAsync('127.0.0.1', $companionPort).Wait(300) -and $companionProbe.Connected }
    catch { $companionOccupied = $false }
    finally { $companionProbe.Dispose() }
    if ($companionOccupied) { continue }
    $companionArgs = @(('"' + $companionScript + '"'), '--port', [string]$companionPort, '--data-root', ('"' + $companionData + '"'))
    $companionOriginalDshRoot = $env:DSH_PACKAGE_ROOT
    try {
        if ($companionPaths.Settings.ContainsKey('dshPackageRoot')) { $env:DSH_PACKAGE_ROOT = $companionPaths.Settings.dshPackageRoot }
    $companionProcess = Start-Process -FilePath $companionNode -ArgumentList $companionArgs -WorkingDirectory $companionOutput -WindowStyle Hidden -RedirectStandardOutput (Join-Path $companionData 'server.stdout.log') -RedirectStandardError (Join-Path $companionData 'server.stderr.log') -PassThru
    } finally { $env:DSH_PACKAGE_ROOT = $companionOriginalDshRoot }
    $companionPid = $companionProcess.Id
    for ($companionAttempt = 0; $companionAttempt -lt 100; $companionAttempt++) {
        try {
            $candidateState = Invoke-RestMethod -Uri ($candidateUrl + '/api/state') -TimeoutSec 1
            if ($candidateState.appId -eq 'deepseek-wallpaper-companion-v1') {
                $companionUrl = $candidateUrl
                $companionSnapshot = $candidateState
                break
            }
        } catch { }
        if ($companionProcess.HasExited) { throw 'The chat service exited; see its application log.' }
        Start-Sleep -Milliseconds 200
    }
    if ($companionUrl) { break }
    throw 'The chat service did not become ready.'
}
}
if (-not $companionUrl) { throw 'No free local companion port was found.' }
@{pid=$companionPid;url=$companionUrl;script=$companionScript;startedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $companionData 'desktop-launch.json') -Encoding UTF8
if ($NoWindows) {
    Write-Output ('DeepSeek local service ready: ' + $companionUrl)
    return
}
if (-not $companionSnapshot.room.connected) {
    Start-Process -FilePath $companionEdge -ArgumentList @(('--app=' + $companionUrl + '/room'), '--window-size=1280,760', '--no-first-run') | Out-Null
}
Start-Process -FilePath $companionEdge -ArgumentList @(('--app=' + $companionUrl + '/chat'), '--window-size=460,780', '--no-first-run') | Out-Null
Write-Output ('DeepSeek chat opened: ' + $companionUrl + '/chat')
