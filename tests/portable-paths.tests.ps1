param()
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $packageRoot 'companion-paths.ps1'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'Portable path helper is missing.' }
. $helper
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('companion-portable-' + [Guid]::NewGuid().ToString('N'))
$passed = 0
function Assert-Equal($Actual, $Expected, $Message) {
    if ($Actual -ne $Expected) { throw ($Message + ': expected ' + $Expected + ', got ' + $Actual) }
    $script:passed++
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    try { & $Action | Out-Null } catch { if ($_.Exception.Message -match $Pattern) { $script:passed++; return }; throw }
    throw ('Expected error: ' + $Pattern)
}
function New-FixtureFile([string]$Relative) {
    $file = Join-Path $fixture $Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
    [IO.File]::WriteAllText($file, '')
    return $file
}
try {
    New-Item -ItemType Directory -Path $fixture -Force | Out-Null
    $envValues = @{USERPROFILE=(Join-Path $fixture 'profile');LOCALAPPDATA=(Join-Path $fixture 'local');APPDATA=(Join-Path $fixture 'roaming');ProgramFiles=(Join-Path $fixture 'program files');'ProgramFiles(x86)'=(Join-Path $fixture 'program files x86')}
    $lively = New-FixtureFile 'local/Programs/Lively Wallpaper/Lively.exe'
    $edge = New-FixtureFile 'program files/Microsoft/Edge/Application/msedge.exe'
    $node = New-FixtureFile 'path node/node.exe'
    $paths = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues $envValues -CommandPaths @{node=$node} -SpecialFolders @{}
    Assert-Equal $paths.LivelyExe $lively 'Find per-user Lively'
    Assert-Equal $paths.EdgeExe $edge 'Find system 64-bit Edge'
    Assert-Equal $paths.NodeExe $node 'Find Node from PATH'
    Assert-Equal $paths.DataRoot (Join-Path $envValues.USERPROFILE '.deepseek-wallpaper-companion') 'Keep user data outside package'
    Assert-Equal (Test-Path -LiteralPath $paths.DataRoot) $false 'Path resolution does not create runtime data'

    $custom = New-FixtureFile 'custom tools/中文 空格/edge.exe'
    $customLively = New-FixtureFile 'custom tools/中文 空格/lively.exe'
    $customNode = New-FixtureFile 'custom tools/中文 空格/node.exe'
    @{edgeExe=$custom;livelyExe=$customLively;nodeExe=$customNode} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'companion-settings.local.json') -Encoding UTF8
    $paths = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues $envValues -CommandPaths @{} -SpecialFolders @{}
    Assert-Equal $paths.EdgeExe $custom 'Custom Edge overrides standard install'
    Assert-Equal $paths.LivelyExe $customLively 'Custom Lively with Unicode and spaces'
    Assert-Equal $paths.NodeExe $customNode 'Custom Node with Unicode and spaces'

    @{edgeExe='custom tools/中文 空格/edge.exe';nodeExe='missing/node.exe'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixture 'companion-settings.local.json') -Encoding UTF8
    $paths = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues $envValues -CommandPaths @{} -SpecialFolders @{}
    Assert-Equal $paths.EdgeExe $custom 'Resolve relative override against package root'
    Assert-Equal $paths.NodeExe (Join-Path $fixture 'missing/node.exe') 'Keep explicit missing override visible instead of silently substituting'
    Remove-Item -LiteralPath (Join-Path $fixture 'companion-settings.local.json')

    $empty = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues @{} -CommandPaths @{} -SpecialFolders @{}
    Assert-Equal $empty.EdgeExe $null 'Empty environment does not search a relative Edge path'
    Assert-Equal $empty.LivelyExe $null 'Empty environment does not search a relative Lively path'
    Assert-Equal $empty.NodeExe $null 'Empty environment is safe for Node lookup'
    Assert-Equal $empty.DataRoot $null 'Empty environment does not invent a profile'
    $fallback = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues @{} -CommandPaths @{} -SpecialFolders @{UserProfile=$envValues.USERPROFILE;LocalApplicationData=$envValues.LOCALAPPDATA;ApplicationData=$envValues.APPDATA}
    Assert-Equal $fallback.DataRoot (Join-Path $envValues.USERPROFILE '.deepseek-wallpaper-companion') 'Use Windows special-folder fallback'
    Assert-Equal $fallback.LivelyExe $lively 'Use LocalApplicationData fallback'

    $systemLively = New-FixtureFile 'other system/Lively Wallpaper/Lively.exe'
    $x86Edge = New-FixtureFile 'other x86/Microsoft/Edge/Application/msedge.exe'
    $systemNode = New-FixtureFile 'other system/nodejs/node.exe'
    $system = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues @{ProgramFiles=(Join-Path $fixture 'other system');'ProgramFiles(x86)'=(Join-Path $fixture 'other x86')} -CommandPaths @{} -SpecialFolders @{}
    Assert-Equal $system.LivelyExe $systemLively 'Find system Lively'
    Assert-Equal $system.EdgeExe $x86Edge 'Find system x86 Edge'
    Assert-Equal $system.NodeExe $systemNode 'Find system Node'

    $manifest = New-FixtureFile 'custom npm/node_modules/@deepseek-ai/dsh/package.json'
    $dshEnv = @{npm_config_prefix=(Join-Path $fixture 'custom npm')}
    $dsh = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues $dshEnv -CommandPaths @{} -SpecialFolders @{}
    Assert-Equal $dsh.DshPackageRoot (Split-Path -Parent $manifest) 'Support nondefault npm prefix'
    $explicitDsh = New-FixtureFile 'manual harness/package.json'
    $dshEnv.DSH_PACKAGE_ROOT = Split-Path -Parent $explicitDsh
    $dsh = Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues $dshEnv -CommandPaths @{} -SpecialFolders @{}
    Assert-Equal $dsh.DshPackageRoot (Split-Path -Parent $explicitDsh) 'Honor DSH_PACKAGE_ROOT first'

    '{"edgeExe":42}' | Set-Content -LiteralPath (Join-Path $fixture 'companion-settings.local.json') -Encoding UTF8
    Assert-Throws { Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues @{} -CommandPaths @{} -SpecialFolders @{} } 'edgeExe.*string'
    '{bad json}' | Set-Content -LiteralPath (Join-Path $fixture 'companion-settings.local.json') -Encoding UTF8
    Assert-Throws { Get-CompanionPaths -PackageRoot $fixture -EnvironmentValues @{} -CommandPaths @{} -SpecialFolders @{} } 'companion-settings.local.json'
    Remove-Item -LiteralPath (Join-Path $fixture 'companion-settings.local.json')
    Assert-Equal (Test-CompanionNodeVersion '22.11.0' '>=22.12.0') $false 'Reject Node below installed commander requirement'
    Assert-Equal (Test-CompanionNodeVersion '24.15.0' '>=22.12.0') $true 'Accept newer Node satisfying installed requirement'
    Assert-Equal (Test-CompanionNodeVersion '22.12.0' '>=22.12.0') $true 'Accept exact minimum'
    Assert-Equal (Test-CompanionNodeVersion '24.15.0' '^22 || ^24') $null 'Report unsupported semver range for manual review'
    $checker = Join-Path $packageRoot 'check-environment.ps1'
    $checks = @(& $checker -PackageRoot $fixture -EnvironmentValues @{} -CommandPaths @{} -SpecialFolders @{} -PassThru)
    Assert-Equal @($checks | Where-Object { $_.Name -eq 'Media' -and $_.Status -eq 'FAIL' }).Count 1 'Checker reports missing media'
    Assert-Equal @($checks | Where-Object { $_.Name -eq 'Harness' -and $_.Status -eq 'FAIL' }).Count 1 'Checker reports missing Harness without loading it'
    Assert-Equal (Test-Path -LiteralPath (Join-Path $fixture '.deepseek-wallpaper-companion')) $false 'Checker does not create runtime data'
    $settingsPath = Join-Path $fixture 'lively settings/Settings.json'
    $markerPath = Join-Path $fixture 'profile/lively-bootstrap-v1.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $settingsPath) -Force | Out-Null
    $originalSettings = '{"Startup":true,"AppFullscreenPause":0,"AudioVolumeGlobal":37,"WebBrowser":0,"WallpaperDir":"D:\\Existing Library","CustomValue":"keep me"}'
    [IO.File]::WriteAllText($settingsPath,$originalSettings)
    $bootstrap = Initialize-CompanionLivelySettings -SettingsPath $settingsPath -LibraryRoot (Join-Path $fixture 'library') -MarkerPath $markerPath
    $bootstrapped = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    Assert-Equal $bootstrapped.Startup $true 'Bootstrap preserves user startup preference'
    Assert-Equal $bootstrapped.AppFullscreenPause 0 'Bootstrap preserves user fullscreen preference'
    Assert-Equal $bootstrapped.AudioVolumeGlobal 37 'Bootstrap preserves user volume preference'
    Assert-Equal $bootstrapped.WebBrowser 1 'First bootstrap selects required WebView2 engine'
    Assert-Equal $bootstrapped.WallpaperDir 'D:\Existing Library' 'Bootstrap preserves existing library'
    Assert-Equal $bootstrapped.CustomValue 'keep me' 'Bootstrap preserves unknown settings'
    Assert-Equal ([IO.File]::ReadAllText($bootstrap.BackupPath)) $originalSettings 'Bootstrap backup preserves original bytes'
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    Assert-Equal (@($marker.changedExistingKeys) -join ',') 'WebBrowser' 'Record exactly the existing setting changed'
    $afterFirst = [IO.File]::ReadAllText($settingsPath)
    Initialize-CompanionLivelySettings -SettingsPath $settingsPath -LibraryRoot (Join-Path $fixture 'library') -MarkerPath $markerPath | Out-Null
    Assert-Equal ([IO.File]::ReadAllText($settingsPath)) $afterFirst 'Later cold starts do not rewrite Lively settings'
    $nodeForTests = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $moduleUri = ([Uri](Join-Path $packageRoot 'companion-paths.mjs')).AbsoluteUri
    $nodeTests = @'
import assert from 'node:assert/strict';
import {join} from 'node:path';
const {companionEdgeCandidates,findCompanionEdge}=await import(process.argv[1]);
const root=process.cwd(),edge=join(root,'Chinese tools','edge.exe');
assert.deepEqual(companionEdgeCandidates({packageRoot:root,environment:{}}),[]);
assert.deepEqual(companionEdgeCandidates({packageRoot:root,environment:{},settings:{edgeExe:edge}}),[edge]);
assert.deepEqual(companionEdgeCandidates({packageRoot:root,environment:{},settings:{edgeExe:'Chinese tools/edge.exe'}}),[edge]);
assert.throws(()=>companionEdgeCandidates({packageRoot:root,environment:{},settings:{edgeExe:42}}));
assert.throws(()=>companionEdgeCandidates({packageRoot:root,environment:{},settings:{edgeExe:'C:relative'}}));
if(process.platform==='win32')assert.throws(()=>companionEdgeCandidates({packageRoot:root,environment:{},settings:{edgeExe:'\\relative'}}));
const standard=join(root,'Program Files','Microsoft','Edge','Application','msedge.exe');
assert.equal(findCompanionEdge(root,{environment:{ProgramFiles:join(root,'Program Files')},exists:p=>p===standard}),standard);
console.log('PASS: optional CLI Edge discovery has 7 isolated Node assertions.');
'@
    & $nodeForTests.Source --input-type=module -e $nodeTests $moduleUri
    if ($LASTEXITCODE -ne 0) { throw 'Optional CLI Edge discovery tests failed.' }
    $wrapperRoot = Join-Path $fixture '便携 启动器'
    $safeFixture = [IO.Path]::GetFullPath($fixture).TrimEnd('\') + '\'
    $safeWrapper = [IO.Path]::GetFullPath($wrapperRoot)
    if (-not $safeWrapper.StartsWith($safeFixture,[StringComparison]::OrdinalIgnoreCase)) { throw 'Wrapper test path escaped the temporary fixture root.' }
    New-Item -ItemType Directory -Path $wrapperRoot -Force | Out-Null
    $sentinel = @'
param([switch]$NoChat)
@{Script=(Split-Path -Leaf $PSCommandPath);NoChat=$NoChat.IsPresent} | ConvertTo-Json | Set-Content -LiteralPath ($PSCommandPath + '.sentinel.json') -Encoding UTF8
'@
    foreach ($entry in @(
        @{Command='start-deepseek-wallpaper-v3.cmd';Script='start-deepseek-wallpaper-v3.ps1';NoChat=$true},
        @{Command='start-deepseek-chat-v4.cmd';Script='start-deepseek-chat-v4.ps1';NoChat=$false},
        @{Command='stop-deepseek-wallpaper-v3.cmd';Script='stop-deepseek-wallpaper-v3.ps1';NoChat=$false}
    )) {
        $wrapperPath = [IO.Path]::GetFullPath((Join-Path $wrapperRoot $entry.Command))
        $sentinelPath = [IO.Path]::GetFullPath((Join-Path $wrapperRoot $entry.Script))
        if (-not $wrapperPath.StartsWith($safeWrapper + '\',[StringComparison]::OrdinalIgnoreCase) -or -not $sentinelPath.StartsWith($safeWrapper + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'A wrapper fixture escaped its intended temporary directory.' }
        Copy-Item -LiteralPath (Join-Path $packageRoot $entry.Command) -Destination $wrapperPath
        [IO.File]::WriteAllText($sentinelPath,$sentinel,(New-Object Text.UTF8Encoding($true)))
        & $env:ComSpec /d /c ('call "' + $wrapperPath + '" <NUL') | Out-Null
        Assert-Equal $LASTEXITCODE 0 ('Source wrapper completes without EXE: ' + $entry.Command)
        $result = Get-Content -LiteralPath ($sentinelPath + '.sentinel.json') -Raw | ConvertFrom-Json
        Assert-Equal $result.Script $entry.Script ('Wrapper dispatches only its fixed script: ' + $entry.Command)
        Assert-Equal $result.NoChat $entry.NoChat ('Wrapper passes the correct mode: ' + $entry.Command)
    }
    if (-not $wrapperPath.StartsWith($safeWrapper + '\',[StringComparison]::OrdinalIgnoreCase) -or -not $sentinelPath.StartsWith($safeWrapper + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Failure fixture escaped its intended temporary directory.' }
    [IO.File]::WriteAllText($sentinelPath,"Write-Output 'SENTINEL_FAILURE_VISIBLE'; exit 7",(New-Object Text.UTF8Encoding($true)))
    $failureOutput = (& $env:ComSpec /d /c ('call "' + $wrapperPath + '" 2>NUL <NUL')) -join "`n"
    Assert-Equal $LASTEXITCODE 7 'Source wrapper preserves a failing PowerShell exit code'
    Assert-Equal ($failureOutput -match 'SENTINEL_FAILURE_VISIBLE') $true 'Source wrapper keeps script failure details visible'
    Assert-Equal ($failureOutput -match 'operation failed') $true 'Source wrapper displays a visible failure summary'
    Write-Output ('PASS: ' + $passed + ' portable path assertions; only isolated temporary fixtures were touched.')
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedFixture) -match '^companion-portable-[a-f0-9]{32}$') { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force -ErrorAction SilentlyContinue }
}
