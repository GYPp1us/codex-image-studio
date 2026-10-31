param([string]$SdkRoot=$env:ANDROID_HOME,[string]$DeviceSerial='emulator-5568')
$ErrorActionPreference='Stop'
$repo=Split-Path (Split-Path $PSScriptRoot)
$qa=Join-Path $repo '.build-cache/android-qa/project'
$native=Join-Path $qa 'android'
New-Item -ItemType Directory -Path $native -Force | Out-Null
foreach($name in @('src','res')) { Copy-Item -LiteralPath (Join-Path $repo "android/$name") -Destination $native -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $repo 'android/build.ps1') -Destination $native
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ChromeInstrumentation.java') -Destination (Join-Path $native 'src/site/arcol/imagestudio/')
New-Item -ItemType Directory -Path (Join-Path $native 'res/raw') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'static/studio-chrome.js') -Destination (Join-Path $native 'res/raw/studio_chrome.js')
$manifest=[IO.File]::ReadAllText((Join-Path $repo 'android/AndroidManifest.xml')).Replace('package="site.arcol.imagestudio"','package="site.arcol.imagestudio.qa"').Replace('android:name=".MainActivity"','android:name="site.arcol.imagestudio.MainActivity"').Replace('</manifest>','<instrumentation android:name="site.arcol.imagestudio.ChromeInstrumentation" android:targetPackage="site.arcol.imagestudio.qa" /></manifest>')
[IO.File]::WriteAllText((Join-Path $native 'AndroidManifest.xml'),$manifest)
# The QA package generates its own throwaway certificate, never the production signing key.
& (Join-Path $native 'build.ps1') -SdkRoot $SdkRoot
if($LASTEXITCODE -ne 0){throw 'QA build failed'}
$adb=Join-Path $SdkRoot 'platform-tools/adb.exe'
& $adb -s $DeviceSerial install -r (Join-Path $qa 'downloads/image-studio.apk')
if($LASTEXITCODE -ne 0){throw 'QA install failed'}
$result=& $adb -s $DeviceSerial shell am instrument -w site.arcol.imagestudio.qa/site.arcol.imagestudio.ChromeInstrumentation
$result
if(($result -join "`n") -notmatch 'PASS: origin channel'){throw 'Native chrome integration failed'}
