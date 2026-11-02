param(
  [string]$SdkRoot = $env:ANDROID_HOME,
  [string]$JdkRoot = $env:JAVA_HOME,
  [string]$SigningDir,
  [string]$OutputDir
)
$ErrorActionPreference = 'Stop'
if (!$SdkRoot) { $SdkRoot = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (!$JdkRoot) { $JdkRoot = Split-Path (Split-Path (Get-Command java).Source) }
$projectRoot = $PSScriptRoot
$workspaceRoot = Split-Path $projectRoot
$toolsRoot = Join-Path $SdkRoot 'build-tools/36.0.0'
$androidJar = Join-Path $SdkRoot 'platforms/android-36/android.jar'
if (!(Test-Path $androidJar) -or !(Test-Path $toolsRoot)) { throw '需要 Android SDK Platform 36 与 Build Tools 36.0.0' }
$buildRoot = Join-Path $projectRoot ('build/' + [guid]::NewGuid().ToString('N'))
if (!$SigningDir -or ![IO.Path]::IsPathFullyQualified($SigningDir)) { throw '必须显式指定现有签名目录 SigningDir 的绝对路径，不会自动创建新密钥。' }
if (!$OutputDir -or ![IO.Path]::IsPathFullyQualified($OutputDir)) { throw '必须显式指定隔离的输出目录 OutputDir 的绝对路径。' }
$signingRoot = $SigningDir
$outputRoot = $OutputDir
foreach ($directory in @($buildRoot,$outputRoot,(Join-Path $buildRoot 'gen'),(Join-Path $buildRoot 'classes'),(Join-Path $buildRoot 'dex'))) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
function Invoke-BuildTool([string]$Executable,[string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "构建工具失败：$Executable ($LASTEXITCODE)" }
}
$keystore = Join-Path $signingRoot 'image-studio.jks'
$passwordFile = Join-Path $signingRoot 'store-password.txt'
if (!(Test-Path $keystore)) { throw '现有签名证书不可用，构建停止；不会生成替代密钥。' }
if (!(Test-Path $passwordFile)) { throw '缺少签名密码，保留已有签名证书以支持后续覆盖安装。' }
$env:STUDIO_ANDROID_STORE_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
try {
  $compiled = Join-Path $buildRoot 'resources.zip'
  $unsigned = Join-Path $buildRoot 'unsigned.apk'
  $aligned = Join-Path $buildRoot 'aligned.apk'
  $gen = Join-Path $buildRoot 'gen'
  $classes = Join-Path $buildRoot 'classes'
  $dex = Join-Path $buildRoot 'dex'
  Invoke-BuildTool (Join-Path $toolsRoot 'aapt2.exe') @('compile','--dir',(Join-Path $projectRoot 'res'),'-o',$compiled)
  Invoke-BuildTool (Join-Path $toolsRoot 'aapt2.exe') @('link','-o',$unsigned,'--manifest',(Join-Path $projectRoot 'AndroidManifest.xml'),'-I',$androidJar,'--java',$gen,'--min-sdk-version','29','--target-sdk-version','36',$compiled)
  $sources = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src'),$gen -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
  Invoke-BuildTool (Join-Path $JdkRoot 'bin/javac.exe') (@('-encoding','UTF-8','--release','8','-classpath',$androidJar,'-d',$classes) + $sources)
  $classJar = Join-Path $buildRoot 'classes.jar'
  Invoke-BuildTool (Join-Path $JdkRoot 'bin/jar.exe') @('--create','--file',$classJar,'-C',$classes,'.')
  # The SDK launchers use JAVA_HOME; restore the caller's setting at the end.
  $previousJavaHome = $env:JAVA_HOME
  $env:JAVA_HOME = $JdkRoot
  Invoke-BuildTool (Join-Path $toolsRoot 'd8.bat') @('--lib',$androidJar,'--min-api','29','--output',$dex,$classJar)
  Invoke-BuildTool (Join-Path $JdkRoot 'bin/jar.exe') @('--update','--file',$unsigned,'-C',$dex,'classes.dex')
  Invoke-BuildTool (Join-Path $toolsRoot 'zipalign.exe') @('-f','4',$unsigned,$aligned)
  $apk = Join-Path $outputRoot 'image-studio.apk'
  Invoke-BuildTool (Join-Path $toolsRoot 'apksigner.bat') @('sign','--ks',$keystore,'--ks-key-alias','image-studio','--ks-pass','env:STUDIO_ANDROID_STORE_PASSWORD','--key-pass','env:STUDIO_ANDROID_STORE_PASSWORD','--out',$apk,$aligned)
  Invoke-BuildTool (Join-Path $toolsRoot 'apksigner.bat') @('verify','--verbose',$apk)
  $sha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $outputRoot 'image-studio.apk.sha256'),"$sha  image-studio.apk`n")
  Write-Output "APK: $apk"
  Write-Output "SHA256: $sha"
} finally {
  Remove-Item Env:STUDIO_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue
  if (Test-Path variable:previousJavaHome) { $env:JAVA_HOME = $previousJavaHome }
}
