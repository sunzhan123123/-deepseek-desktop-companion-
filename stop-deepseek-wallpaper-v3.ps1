param()

$ErrorActionPreference = 'Stop'
$companionOutput = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $companionOutput 'companion-paths.ps1')
$companionPaths = Get-CompanionPaths -PackageRoot $companionOutput
$companionData = $companionPaths.DataRoot
if (-not $companionData) { throw 'The Windows user profile could not be resolved. Start this launcher in a standard Windows user session.' }
$companionLively = $companionPaths.LivelyExe
if (-not $companionPaths.LivelyDataRoot -or -not $companionPaths.LivelyLibraryRoot) { throw 'Lively data paths could not be resolved. Set livelyDataRoot and livelyLibraryRoot in companion-settings.local.json.' }
$companionProject = Join-Path $companionPaths.LivelyLibraryRoot 'wallpapers/deepseek-room-v3'
$companionLayoutFile = Join-Path $companionPaths.LivelyDataRoot 'WallpaperLayout.json'
$companionBackendStop = Join-Path $companionOutput 'stop-deepseek-chat-v1.ps1'

function Test-CompanionOwnedPath($Path) {
    if (-not $Path) { return $false }
    try { return [IO.Path]::GetFullPath([string]$Path).TrimEnd('\','/').Equals([IO.Path]::GetFullPath($companionProject).TrimEnd('\','/'), [StringComparison]::OrdinalIgnoreCase) }
    catch { return $false }
}

$companionLayout = @()
if (Test-Path -LiteralPath $companionLayoutFile -PathType Leaf) {
    $companionParsedLayout = Get-Content -LiteralPath $companionLayoutFile -Raw | ConvertFrom-Json
    $companionLayout = @($companionParsedLayout)
}
$companionOwned = @($companionLayout | Where-Object { Test-CompanionOwnedPath $_.LivelyInfoPath })
if ($companionOwned.Count -gt 0 -and -not (Get-Process -Name Lively -ErrorAction SilentlyContinue)) {
    # A saved restore entry is not an active wallpaper. Do not launch a stopped
    # host just to close it; remove only this project's offline restore entry.
    $companionRemaining = @($companionLayout | Where-Object { -not (Test-CompanionOwnedPath $_.LivelyInfoPath) })
    if (Get-Process -Name Lively -ErrorAction SilentlyContinue) { throw 'Lively started while its offline layout was being checked. Run the stop launcher again so it can close the active wallpaper safely.' }
    ConvertTo-Json -InputObject $companionRemaining -Depth 20 | Set-Content -LiteralPath $companionLayoutFile -Encoding UTF8
    $companionOwned = @()
}
foreach ($companionEntry in $companionOwned) {
    if (-not (Test-Path -LiteralPath $companionLively -PathType Leaf)) { throw 'Lively is missing, so the owned desktop wallpaper could not be closed. Restore the official Lively installation or close DeepSeek Desktop Room from Lively, then try again.' }
    $companionMonitor = 0
    if (-not [int]::TryParse([string]$companionEntry.LivelyScreen.Index, [ref]$companionMonitor) -or $companionMonitor -lt 1) { throw 'The owned wallpaper monitor could not be identified safely. Close DeepSeek Desktop Room from Lively, then run this stop launcher again.' }
    $companionClose = Start-Process -FilePath $companionLively -ArgumentList @('closewp', '--monitor', [string]$companionMonitor) -WindowStyle Hidden -Wait -PassThru
    if ($companionClose.ExitCode -ne 0) { throw ('Lively could not close the owned wallpaper (exit ' + $companionClose.ExitCode + '). Close DeepSeek Desktop Room from Lively, then try again.') }
}
if ($companionOwned.Count -gt 0) {
    $companionCloseDeadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $companionStillOwned = $true
        try {
            if (Test-Path -LiteralPath $companionLayoutFile -PathType Leaf) {
                $companionParsedCurrentLayout = Get-Content -LiteralPath $companionLayoutFile -Raw | ConvertFrom-Json
                $companionCurrentLayout = @($companionParsedCurrentLayout)
                $companionStillOwned = @($companionCurrentLayout | Where-Object { Test-CompanionOwnedPath $_.LivelyInfoPath }).Count -gt 0
            }
        } catch { }
        if (-not $companionStillOwned) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $companionCloseDeadline)
    if ($companionStillOwned) { throw 'Lively did not confirm closing the owned wallpaper within 15 seconds. The local service remains running. Close DeepSeek Desktop Room in Lively, then run this stop launcher again.' }
}
if (-not (Test-Path -LiteralPath $companionBackendStop -PathType Leaf)) { throw 'The companion backend stop launcher is missing. Restore stop-deepseek-chat-v1.ps1 from the complete companion package.' }
& $companionBackendStop
Write-Output 'DeepSeek desktop wallpaper stopped. Other Lively wallpapers were left in place.'
