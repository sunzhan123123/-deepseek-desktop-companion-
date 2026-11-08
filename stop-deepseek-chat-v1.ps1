$ErrorActionPreference = 'Stop'
$companionOutput = $PSScriptRoot
. (Join-Path $companionOutput 'companion-paths.ps1')
$companionPaths = Get-CompanionPaths -PackageRoot $companionOutput
$companionData = $companionPaths.DataRoot
if (-not $companionData) { throw 'The Windows user profile could not be resolved. Start this launcher in a standard Windows user session.' }
$companionRecords = @((Join-Path $companionData 'desktop-launch.json'), (Join-Path $companionData 'server-v1.json'))
foreach ($companionRecord in $companionRecords) {
    if (-not (Test-Path -LiteralPath $companionRecord)) { continue }
    $companionSaved = Get-Content -LiteralPath $companionRecord -Raw | ConvertFrom-Json
    $companionUri = [Uri]$companionSaved.url
    if ($companionUri.Host -ne '127.0.0.1' -or $companionUri.Scheme -ne 'http') { continue }
    try {
        $companionState = Invoke-RestMethod -Uri ($companionSaved.url + '/api/state') -TimeoutSec 2
        if ($companionState.appId -ne 'deepseek-wallpaper-companion-v1') { continue }
        Invoke-RestMethod -Method Post -Uri ($companionSaved.url + '/api/shutdown') -Headers @{Origin=$companionSaved.url} -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null
        Write-Output 'DeepSeek chat service stopped.'
        exit 0
    } catch { }
}
Write-Output 'No running DeepSeek companion service was found.'
