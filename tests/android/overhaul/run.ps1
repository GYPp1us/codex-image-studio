param(
  [string]$DeviceSerial,
  [string]$SigningDir,
  [string]$SdkRoot=$env:ANDROID_HOME,
  [switch]$PrepareOnly,
  [string]$PreparedProject,
  [int]$LiveFixturePort,
  [string]$LiveFixtureToken,
  [string]$LiveNormalId,
  [string]$LiveUpscaleId,
  [string]$LiveAssetId
)
$ErrorActionPreference='Stop'
if (-not $SdkRoot) { $SdkRoot=Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$repo=Split-Path (Split-Path (Split-Path $PSScriptRoot))
if ($PreparedProject) {
  if (-not [IO.Path]::IsPathFullyQualified($PreparedProject)) { throw 'PreparedProject must be an absolute path.' }
  $qa=$PreparedProject
  if (-not (Test-Path -LiteralPath (Join-Path $qa 'output/image-studio.apk'))) { throw 'Prepared QA APK not found.' }
} else {
  if (-not $SigningDir -or -not [IO.Path]::IsPathFullyQualified($SigningDir)) { throw 'SigningDir must be an absolute path to an existing test signing directory.' }
  $qa=Join-Path $repo ('.build-cache/overhaul/repro-' + [guid]::NewGuid().ToString('N'))
  $native=Join-Path $qa 'android'
  $raw=Join-Path $native 'res/raw'
  New-Item -ItemType Directory -Force $native | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo 'android/src'),(Join-Path $repo 'android/res') -Destination $native -Recurse
  Copy-Item -LiteralPath (Join-Path $repo 'android/build.ps1') -Destination $native
  New-Item -ItemType Directory -Force $raw | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'VisualInstrumentation.java') -Destination (Join-Path $native 'src/site/arcol/imagestudio/')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'theme_matrix.js'),(Join-Path $PSScriptRoot 'incremental_qa.js') -Destination $raw
  Copy-Item -LiteralPath (Join-Path $repo 'tests/generation-visual-qa.js') -Destination (Join-Path $raw 'generation_visual_qa.js')
  Copy-Item -LiteralPath (Join-Path $repo 'tests/generation-browser-qa.js') -Destination (Join-Path $raw 'generation_browser_qa.js')
  Copy-Item -LiteralPath (Join-Path $repo 'tests/generation-integrated-qa.js') -Destination (Join-Path $raw 'generation_integrated_qa.js')
  Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'fixtures') -Filter '*.json' | Copy-Item -Destination $raw
  $hashes=@()
  Get-ChildItem -LiteralPath (Join-Path $repo 'static') -File | Where-Object { $_.Extension -in '.js','.css','.html' } | ForEach-Object {
    $stem=$_.BaseName.Replace('-','_')
    $suffix=if ($_.Name -eq 'index.html') { '' } else { '_' + $_.Extension.TrimStart('.') }
    $target=Join-Path $raw ('qa_' + $stem + $suffix + $_.Extension)
    Copy-Item -LiteralPath $_.FullName -Destination $target
    $sourceHash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $sourceHash) { throw "Fixture copy differs: $($_.Name)" }
    $hashes += "$sourceHash  static/$($_.Name)"
  }
  $hashes | Sort-Object | Set-Content -Encoding utf8 (Join-Path $qa 'static.sha256')
  $manifest=[IO.File]::ReadAllText((Join-Path $repo 'android/AndroidManifest.xml')).Replace('android:usesCleartextTraffic="false"','android:usesCleartextTraffic="true"').Replace('package="site.arcol.imagestudio"','package="site.arcol.imagestudio.qa"').Replace('android:name=".MainActivity"','android:name="site.arcol.imagestudio.MainActivity"').Replace('</manifest>','<instrumentation android:name="site.arcol.imagestudio.VisualInstrumentation" android:targetPackage="site.arcol.imagestudio.qa" /></manifest>')
  [IO.File]::WriteAllText((Join-Path $native 'AndroidManifest.xml'),$manifest)
  # The QA activity waits for the local intercepted fixture instead of loading HOME.
  $activity=Join-Path $native 'src/site/arcol/imagestudio/MainActivity.java'
  $text=[IO.File]::ReadAllText($activity)
  $load='if(savedInstanceState==null || web.restoreState(savedInstanceState)==null)web.loadUrl(HOME);'
  if (-not $text.Contains($load)) { throw 'QA startup patch no longer matches MainActivity; review before testing.' }
  $text=$text.Replace($load,'/* QA instrumentation supplies an intercepted local fixture. */')
  [IO.File]::WriteAllText($activity,$text)
  & (Join-Path $native 'build.ps1') -SdkRoot $SdkRoot -SigningDir $SigningDir -OutputDir (Join-Path $qa 'output')
  if ($LASTEXITCODE -ne 0) { throw 'QA build failed.' }
}
if ($PrepareOnly) { Write-Output "Prepared QA project: $qa"; return }
if (-not $DeviceSerial) { throw 'DeviceSerial must identify the intended isolated device.' }
$hashFile=Join-Path $qa 'static.sha256'
if (-not (Test-Path -LiteralPath $hashFile)) { throw 'Prepared fixture hashes are missing.' }
$entries=@(Get-Content -LiteralPath $hashFile | Where-Object { $_.Trim() })
$current=@(Get-ChildItem -LiteralPath (Join-Path $repo 'static') -File | Where-Object { $_.Extension -in '.js','.css','.html' })
if ($entries.Count -ne $current.Count) { throw 'Static file set changed after QA preparation.' }
foreach ($entry in $entries) {
  $parts=$entry -split '  ',2
  if ($parts.Count -ne 2) { throw 'Invalid fixture hash entry.' }
  $source=Join-Path $repo $parts[1]
  if (-not (Test-Path -LiteralPath $source) -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $parts[0]) { throw "Static source changed after QA preparation: $($parts[1])" }
}
$adb=Join-Path $SdkRoot 'platform-tools/adb.exe'
& $adb -s $DeviceSerial install -r (Join-Path $qa 'output/image-studio.apk')
if ($LASTEXITCODE -ne 0) { throw 'QA install failed; existing app data was not cleared.' }
& $adb -s $DeviceSerial shell am force-stop site.arcol.imagestudio.qa
if ($LiveFixturePort) {
  if (!$LiveFixtureToken -or !$LiveNormalId -or !$LiveUpscaleId -or !$LiveAssetId) { throw 'Live fixture requires its synthetic token and three IDs.' }
  $result=& $adb -s $DeviceSerial shell am instrument -w -e live 1 -e port $LiveFixturePort -e token $LiveFixtureToken -e normal $LiveNormalId -e upscale $LiveUpscaleId -e asset $LiveAssetId site.arcol.imagestudio.qa/site.arcol.imagestudio.VisualInstrumentation
} else {
  $result=& $adb -s $DeviceSerial shell am instrument -w site.arcol.imagestudio.qa/site.arcol.imagestudio.VisualInstrumentation
}
$result
if (($result -join "`n") -notmatch 'PASS: (WebView theme captures|live SQLite pages and screenshots)') { throw 'WebView visual and incremental checks failed.' }
Write-Output "Fixture hashes: $(Join-Path $qa 'static.sha256')"
Write-Output 'The script does not start or stop a device; shut down any agent-started emulator immediately after active testing.'
