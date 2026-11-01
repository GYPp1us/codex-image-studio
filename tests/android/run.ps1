param(
  [string]$SdkRoot=$env:ANDROID_HOME,
  [Parameter(Mandatory=$true)][string]$DeviceSerial,
  [Parameter(Mandatory=$true)][string]$SigningDir
)
$ErrorActionPreference='Stop'
if (!$SdkRoot) { $SdkRoot = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (![IO.Path]::IsPathFullyQualified($SigningDir)) { throw 'SigningDir 必须是现有测试签名目录的绝对路径。' }
if (!(Test-Path -LiteralPath (Join-Path $SigningDir 'image-studio.jks')) -or !(Test-Path -LiteralPath (Join-Path $SigningDir 'store-password.txt'))) { throw '测试签名材料不存在；脚本不会生成或替换签名。' }
$repo=Split-Path (Split-Path $PSScriptRoot)
$qa=Join-Path $repo ('.build-cache/android-qa/' + [guid]::NewGuid().ToString('N'))
$native=Join-Path $qa 'android'
New-Item -ItemType Directory -Path $native -Force | Out-Null
foreach($name in @('src','res')) { Copy-Item -LiteralPath (Join-Path $repo "android/$name") -Destination $native -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $repo 'android/build.ps1') -Destination $native
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ChromeInstrumentation.java') -Destination (Join-Path $native 'src/site/arcol/imagestudio/')
New-Item -ItemType Directory -Path (Join-Path $native 'res/raw') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'static/studio-chrome.js') -Destination (Join-Path $native 'res/raw/studio_chrome.js')
$manifest=[IO.File]::ReadAllText((Join-Path $repo 'android/AndroidManifest.xml')).Replace('package="site.arcol.imagestudio"','package="site.arcol.imagestudio.qa"').Replace('android:name=".MainActivity"','android:name="site.arcol.imagestudio.MainActivity"').Replace('</manifest>','<instrumentation android:name="site.arcol.imagestudio.ChromeInstrumentation" android:targetPackage="site.arcol.imagestudio.qa" /></manifest>')
[IO.File]::WriteAllText((Join-Path $native 'AndroidManifest.xml'),$manifest)
# The caller supplies existing QA signing material; never create or copy a key.
$output=Join-Path $qa 'output'
& (Join-Path $native 'build.ps1') -SdkRoot $SdkRoot -SigningDir $SigningDir -OutputDir $output
if($LASTEXITCODE -ne 0){throw 'QA build failed'}
$adb=Join-Path $SdkRoot 'platform-tools/adb.exe'
& $adb -s $DeviceSerial install -r (Join-Path $output 'image-studio.apk')
if($LASTEXITCODE -ne 0){throw 'QA install failed'}
$result=& $adb -s $DeviceSerial shell am instrument -w site.arcol.imagestudio.qa/site.arcol.imagestudio.ChromeInstrumentation
$result
if(($result -join "`n") -notmatch 'PASS: origin channel'){throw 'Native chrome integration failed'}
