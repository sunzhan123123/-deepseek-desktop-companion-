# Shared, read-only discovery. Dot-sourcing this file never creates runtime data.
function ConvertTo-CompanionAbsolutePath {
    param([string]$Value, [string]$BaseDirectory)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $value = $Value.Trim()
    if ($value -match '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)') { return [IO.Path]::GetFullPath($value) }
    if ($value -match ':' -or [IO.Path]::IsPathRooted($value)) { throw ('Use a full absolute path or a package-relative path: ' + $value) }
    if ([string]::IsNullOrWhiteSpace($BaseDirectory)) { return $null }
    return [IO.Path]::GetFullPath((Join-Path $BaseDirectory $value))
}

function Get-CompanionSettings {
    param([Parameter(Mandatory=$true)][string]$PackageRoot)
    $settingsFile = Join-Path $PackageRoot 'companion-settings.local.json'
    $result = @{}
    if (-not (Test-Path -LiteralPath $settingsFile -PathType Leaf)) { return $result }
    try { $parsed = Get-Content -LiteralPath $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Cannot read companion-settings.local.json. Use a JSON object with path strings only.' }
    if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) { throw 'companion-settings.local.json must be a JSON object.' }
    foreach ($key in @('livelyExe','edgeExe','nodeExe','livelyDataRoot','livelyLibraryRoot','dshPackageRoot')) {
        $property = $parsed.PSObject.Properties[$key]
        if ($null -eq $property -or $null -eq $property.Value) { continue }
        if ($property.Value -isnot [string]) { throw ($key + ' in companion-settings.local.json must be a path string.') }
        if (-not [string]::IsNullOrWhiteSpace($property.Value)) { $result[$key] = ConvertTo-CompanionAbsolutePath -Value $property.Value -BaseDirectory $PackageRoot }
    }
    return $result
}

function Get-CompanionPaths {
    param(
        [Parameter(Mandatory=$true)][string]$PackageRoot,
        [System.Collections.IDictionary]$EnvironmentValues,
        [System.Collections.IDictionary]$CommandPaths,
        [System.Collections.IDictionary]$SpecialFolders
    )
    $PackageRoot = [IO.Path]::GetFullPath($PackageRoot)
    $settings = Get-CompanionSettings -PackageRoot $PackageRoot
    if ($null -eq $EnvironmentValues) {
        $EnvironmentValues = @{}
        foreach ($key in @('USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','ProgramW6432','DSH_PACKAGE_ROOT','npm_config_prefix')) { $EnvironmentValues[$key] = [Environment]::GetEnvironmentVariable($key) }
    }
    if ($null -eq $SpecialFolders) {
        $SpecialFolders = @{}
        foreach ($key in @('UserProfile','LocalApplicationData','ApplicationData','ProgramFiles','ProgramFilesX86')) { $SpecialFolders[$key] = [Environment]::GetFolderPath($key) }
    }
    if ($null -eq $CommandPaths) {
        $CommandPaths = @{}
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($nodeCommand) { $CommandPaths['node'] = $nodeCommand.Source }
    }
    $bases = @{}
    $fallbacks = @{USERPROFILE='UserProfile';LOCALAPPDATA='LocalApplicationData';APPDATA='ApplicationData';ProgramFiles='ProgramFiles';'ProgramFiles(x86)'='ProgramFilesX86'}
    foreach ($key in @('USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','ProgramW6432','npm_config_prefix')) {
        $candidate = [string]$EnvironmentValues[$key]
        if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)') {
            $candidate = if ($fallbacks.ContainsKey($key)) { [string]$SpecialFolders[$fallbacks[$key]] } else { $null }
        }
        $bases[$key] = if (-not [string]::IsNullOrWhiteSpace($candidate) -and $candidate -match '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)') { [IO.Path]::GetFullPath($candidate) } else { $null }
    }
    $candidates = @{livelyExe=@();edgeExe=@();nodeExe=@();dshPackageRoot=@()}
    foreach ($key in @('LOCALAPPDATA','ProgramW6432','ProgramFiles','ProgramFiles(x86)')) {
        $base = $bases[$key]
        if (-not $base) { continue }
        if ($key -eq 'LOCALAPPDATA') { $candidates.livelyExe += Join-Path $base 'Programs/Lively Wallpaper/Lively.exe' }
        else { $candidates.livelyExe += Join-Path $base 'Lively Wallpaper/Lively.exe' }
        $candidates.edgeExe += Join-Path $base 'Microsoft/Edge/Application/msedge.exe'
        if ($key -ne 'LOCALAPPDATA') { $candidates.nodeExe += Join-Path $base 'nodejs/node.exe' }
        else { $candidates.nodeExe += Join-Path $base 'Programs/nodejs/node.exe' }
    }
    if ($CommandPaths['node']) { $candidates.nodeExe += [string]$CommandPaths['node'] }
    if ($EnvironmentValues['DSH_PACKAGE_ROOT']) { $candidates.dshPackageRoot += ConvertTo-CompanionAbsolutePath -Value $EnvironmentValues['DSH_PACKAGE_ROOT'] -BaseDirectory $PackageRoot }
    if ($bases.APPDATA) { $candidates.dshPackageRoot += Join-Path $bases.APPDATA 'npm/node_modules/@deepseek-ai/dsh' }
    if ($bases.npm_config_prefix) { $candidates.dshPackageRoot += Join-Path $bases.npm_config_prefix 'node_modules/@deepseek-ai/dsh' }
    if ($CommandPaths['node']) { $candidates.dshPackageRoot += Join-Path (Split-Path -Parent ([string]$CommandPaths['node'])) 'node_modules/@deepseek-ai/dsh' }
    $found = @{}
    foreach ($key in @('livelyExe','edgeExe','nodeExe','dshPackageRoot')) {
        if ($settings.ContainsKey($key)) { $found[$key] = $settings[$key]; continue }
        $found[$key] = $null
        foreach ($candidate in @($candidates[$key] | Select-Object -Unique)) {
            if (-not $candidate) { continue }
            $probe = if ($key -eq 'dshPackageRoot') { Join-Path $candidate 'package.json' } else { $candidate }
            if (Test-Path -LiteralPath $probe -PathType Leaf) { $found[$key] = [IO.Path]::GetFullPath($candidate); break }
        }
    }
    $dataRoot = if ($bases.USERPROFILE) { Join-Path $bases.USERPROFILE '.deepseek-wallpaper-companion' } else { $null }
    $livelyDataRoot = if ($settings.ContainsKey('livelyDataRoot')) { $settings.livelyDataRoot } elseif ($bases.LOCALAPPDATA) { Join-Path $bases.LOCALAPPDATA 'Lively Wallpaper' } else { $null }
    $livelyLibrary = if ($settings.ContainsKey('livelyLibraryRoot')) { $settings.livelyLibraryRoot } elseif ($livelyDataRoot) { Join-Path $livelyDataRoot 'Library' } else { $null }
    $webViewRoots = @()
    foreach ($key in @('LOCALAPPDATA','ProgramW6432','ProgramFiles','ProgramFiles(x86)')) { if ($bases[$key]) { $webViewRoots += Join-Path $bases[$key] 'Microsoft/EdgeWebView/Application' } }
    return [pscustomobject]@{
        PackageRoot=$PackageRoot;Settings=$settings;DataRoot=$dataRoot;LivelyExe=$found.livelyExe;EdgeExe=$found.edgeExe;NodeExe=$found.nodeExe;DshPackageRoot=$found.dshPackageRoot;
        LivelyDataRoot=$livelyDataRoot;LivelyLibraryRoot=$livelyLibrary;WebViewRoots=@($webViewRoots | Select-Object -Unique)
    }
}

function Assert-CompanionExecutable {
    param([string]$Path, [string]$Name, [string]$Setting)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw ($Name + ' was not found. Install it manually or set ' + $Setting + ' in companion-settings.local.json; run check-environment.cmd for details.') }
}

function Test-CompanionNodeVersion {
    param([string]$Version, [string]$Requirement)
    if ($Version -notmatch '^v?(\d+)\.(\d+)\.(\d+)') { return $null }
    $actualVersion = [version]($Matches[1] + '.' + $Matches[2] + '.' + $Matches[3])
    if ($Requirement -notmatch '^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$') { return $null }
    $minimumVersion = [version]([int]$Matches[1], [int]$Matches[2], [int]$Matches[3] -join '.')
    return $actualVersion -ge $minimumVersion
}

# This mutating helper is called only by the wallpaper launcher while Lively is
# stopped. Path discovery and check-environment never call it.
function Initialize-CompanionLivelySettings {
    param([string]$SettingsPath, [string]$LibraryRoot, [string]$MarkerPath)
    if (Test-Path -LiteralPath $MarkerPath -PathType Leaf) { return [pscustomobject]@{Applied=$false;BackupPath=$null} }
    $hostSettings = [pscustomobject]@{}
    $backupPath = $null
    if (Test-Path -LiteralPath $SettingsPath -PathType Leaf) {
        $hostSettings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -eq $hostSettings -or $hostSettings -isnot [pscustomobject]) { throw 'Lively Settings.json is not a settings object. Restore a valid backup before starting the desktop room.' }
        $backupPath = $SettingsPath + '.deepseek-bootstrap-' + [Guid]::NewGuid().ToString('N') + '.bak'
        Copy-Item -LiteralPath $SettingsPath -Destination $backupPath
    }
    $defaults = @{AppVersion='2.2.1.0';WebBrowser=1;AppFocusPause=1;AppFullscreenPause=1;BatteryPause=1;RemoteDesktopPause=1;PowerSaveModePause=1;Startup=$false;IsFirstRun=$false;ControlPanelOpened=$false;AudioVolumeGlobal=0;WallpaperDir=$LibraryRoot}
    $addedKeys = @()
    $changedKeys = @()
    foreach ($key in $defaults.Keys) {
        if ($null -eq $hostSettings.PSObject.Properties[$key]) {
            Add-Member -InputObject $hostSettings -MemberType NoteProperty -Name $key -Value $defaults[$key]
            $addedKeys += $key
        }
    }
    # WebView2 is the sole existing preference this first-start compatibility
    # bootstrap may change; retain startup, pausing, volume and all other keys.
    if ($hostSettings.WebBrowser -ne 1) { $hostSettings.WebBrowser = 1; $changedKeys += 'WebBrowser' }
    if ($addedKeys.Count -gt 0 -or $changedKeys.Count -gt 0) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $SettingsPath) -Force | Out-Null
        $hostSettings | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $SettingsPath -Encoding UTF8
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $MarkerPath) -Force | Out-Null
    @{version=1;settingsPath=$SettingsPath;backupPath=$backupPath;addedKeys=@($addedKeys | Sort-Object);changedExistingKeys=$changedKeys;bootstrappedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $MarkerPath -Encoding UTF8
    return [pscustomobject]@{Applied=$true;BackupPath=$backupPath}
}
