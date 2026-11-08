param(
    [string]$PackageRoot = $PSScriptRoot,
    [switch]$Json,
    [switch]$PassThru,
    [System.Collections.IDictionary]$EnvironmentValues,
    [System.Collections.IDictionary]$CommandPaths,
    [System.Collections.IDictionary]$SpecialFolders
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
$checks = New-Object System.Collections.Generic.List[object]
function Add-CompanionCheck([string]$Name, [string]$Status, [string]$Message, [string]$Path, [string]$Version) {
    $checks.Add([pscustomobject]@{Name=$Name;Status=$Status;Message=$Message;Path=$Path;Version=$Version})
}
function Get-CompanionFileVersion([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return [Diagnostics.FileVersionInfo]::GetVersionInfo($Path).FileVersion } catch { return $null }
}
try {
    $arguments = @{PackageRoot=$PackageRoot}
    if ($PSBoundParameters.ContainsKey('EnvironmentValues')) { $arguments.EnvironmentValues = $EnvironmentValues }
    if ($PSBoundParameters.ContainsKey('CommandPaths')) { $arguments.CommandPaths = $CommandPaths }
    if ($PSBoundParameters.ContainsKey('SpecialFolders')) { $arguments.SpecialFolders = $SpecialFolders }
    $paths = Get-CompanionPaths @arguments
    $windows = [Environment]::OSVersion
    $windowsStatus = if ($windows.Platform -eq [PlatformID]::Win32NT -and $windows.Version.Major -ge 10) { 'OK' } else { 'FAIL' }
    Add-CompanionCheck 'Windows' $windowsStatus 'Windows 10/11 desktop is required; reported OS version may depend on the host manifest.' '' $windows.Version.ToString()
    Add-CompanionCheck 'PowerShell' $(if ($PSVersionTable.PSVersion -ge [version]'5.1') {'OK'} else {'FAIL'}) 'Windows PowerShell 5.1 launchers are supported.' '' $PSVersionTable.PSVersion.ToString()

    $manifest = $null
    $manifestPath = if ($paths.DshPackageRoot) { Join-Path $paths.DshPackageRoot 'package.json' } else { $null }
    $requirement = '>=22.12.0'
    $requirementSource = 'tested Harness 0.2.1-rc.2 dependency commander 15; installed manifest unavailable'
    if ($manifestPath -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    }
    if ($manifest -and $manifest.name -eq '@deepseek-ai/dsh' -and (Test-Path -LiteralPath (Join-Path $paths.DshPackageRoot 'lib/bin.js') -PathType Leaf)) {
        $harnessStatus = if ($manifest.version -eq '0.2.1-rc.2') { 'OK' } else { 'WARN' }
        Add-CompanionCheck 'Harness' $harnessStatus 'Expected official @deepseek-ai/dsh 0.2.1-rc.2; no Harness code or credentials were loaded.' $paths.DshPackageRoot $manifest.version
        if ($manifest.engines -and $manifest.engines.node) { $requirement = [string]$manifest.engines.node; $requirementSource = 'installed dsh package.json engines.node' }
        else {
            $commanderPath = Join-Path $paths.DshPackageRoot 'node_modules/commander/package.json'
            if (Test-Path -LiteralPath $commanderPath -PathType Leaf) {
                try {
                    $commander = Get-Content -LiteralPath $commanderPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    if ($commander.engines.node) { $requirement = [string]$commander.engines.node; $requirementSource = 'dsh has no top-level engines; installed commander ' + $commander.version + ' engines.node' }
                } catch { }
            }
        }
    } else { Add-CompanionCheck 'Harness' 'FAIL' 'Official @deepseek-ai/dsh package/lib/bin.js not found. Install manually or set DSH_PACKAGE_ROOT (or dshPackageRoot in local settings).' $paths.DshPackageRoot '' }

    $nodeVersion = Get-CompanionFileVersion $paths.NodeExe
    if (-not $paths.NodeExe -or -not (Test-Path -LiteralPath $paths.NodeExe -PathType Leaf)) { Add-CompanionCheck 'Node' 'FAIL' ('Node was not found; requirement ' + $requirement + ' from ' + $requirementSource + '.') $paths.NodeExe '' }
    else {
        $satisfies = Test-CompanionNodeVersion $nodeVersion $requirement
        $nodeStatus = if ($null -eq $satisfies) { 'WARN' } elseif ($satisfies) { 'OK' } else { 'FAIL' }
        Add-CompanionCheck 'Node' $nodeStatus ('Requirement ' + $requirement + ' from ' + $requirementSource + '. Version read from EXE resources only; unknown ranges/resources need manual review.') $paths.NodeExe $nodeVersion
    }
    foreach ($application in @(@{Name='Edge';Path=$paths.EdgeExe;Expected=$null}, @{Name='Lively';Path=$paths.LivelyExe;Expected='2.2.1.0'})) {
        $version = Get-CompanionFileVersion $application.Path
        if (-not $application.Path -or -not (Test-Path -LiteralPath $application.Path -PathType Leaf)) { Add-CompanionCheck $application.Name 'FAIL' ('Install manually or set ' + $application.Name.ToLowerInvariant() + 'Exe in companion-settings.local.json.') $application.Path '' }
        else {
            $status = if (-not $version -or ($application.Expected -and $version -ne $application.Expected)) { 'WARN' } else { 'OK' }
            Add-CompanionCheck $application.Name $status $(if ($application.Expected) { 'Tested Lively version: 2.2.1.0. Other versions need manual validation.' } else { 'Microsoft Edge is used for the independent chat window.' }) $application.Path $version
        }
    }
    $webView = $null
    foreach ($root in $paths.WebViewRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $webView = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'msedgewebview2.exe' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if ($webView) { break }
    }
    Add-CompanionCheck 'WebView2' $(if ($webView) {'OK'} else {'WARN'}) 'Evergreen WebView2 runtime is required by Lively WebView2. Discovery checks standard installed files; a custom/fixed runtime needs manual confirmation.' $webView (Get-CompanionFileVersion $webView)
    $media = @('room-animation-v2/AB.mp4','room-animation-v2/BA.mp4','room-animation-v2/BC.mp4','room-animation-v2/CB.mp4','room-animation-v2/CD.mp4','room-animation-v2/DC.mp4','room-animation-v2/DE.mp4','room-animation-v2/ED.mp4','room-animation-v2/EF.mp4','room-animation-v2/FE.mp4','room-animation-v2/loop-B.mp4','room-animation-v2/loop-E.mp4','room-animation-v2/loop-F.mp4','room-animation-v2/pose-A.png','room-animation-v2/pose-B.png','room-animation-v2/pose-C.png','room-animation-v2/pose-D.png','room-animation-v2/pose-E.png','room-animation-v2/pose-F.png','companion-typing-v1/B.mp4','companion-typing-v1/E.mp4')
    $missing = @($media | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PackageRoot $_) -PathType Leaf) })
    Add-CompanionCheck 'Media' $(if ($missing.Count -eq 0) {'OK'} else {'FAIL'}) $(if ($missing.Count) { 'Missing ' + $missing.Count + '/21 media files: ' + ($missing -join ', ') } else { 'All 21 required media files exist. File presence does not validate codecs or playback.' }) $PackageRoot ''
} catch { Add-CompanionCheck 'Configuration' 'FAIL' $_.Exception.Message '' '' }
if ($PassThru) { return $checks.ToArray() }
if ($Json) { ConvertTo-Json -InputObject $checks.ToArray() -Depth 4 }
else {
    Write-Output 'Read-only environment report: no installs, login, runtime directories, Harness processes, credentials, or Lively settings changes.'
    foreach ($check in $checks) {
        Write-Output ('[' + $check.Status + '] ' + $check.Name + $(if ($check.Version) {' ' + $check.Version} else {''}) + ': ' + $check.Message)
        if ($check.Path) { Write-Output ('  ' + $check.Path) }
    }
}
if (@($checks | Where-Object {$_.Status -eq 'FAIL'}).Count -gt 0) { exit 1 }
