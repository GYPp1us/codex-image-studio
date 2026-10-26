param(
  [string]$SdkRoot = $env:ANDROID_HOME,
  [string]$JdkRoot = $env:JAVA_HOME
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
$signingRoot = Join-Path $projectRoot 'signing'
$outputRoot = Join-Path $workspaceRoot 'downloads'
foreach ($directory in @($buildRoot,$signingRoot,$outputRoot,(Join-Path $buildRoot 'gen'),(Join-Path $buildRoot 'classes'),(Join-Path $buildRoot 'dex'))) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
function Invoke-BuildTool([string]$Executable,[string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "构建工具失败：$Executable ($LASTEXITCODE)" }
}
$keystore = Join-Path $signingRoot 'image-studio.jks'
$passwordFile = Join-Path $signingRoot 'store-password.txt'
if (!(Test-Path $keystore)) {
  if (!(Test-Path $passwordFile)) {
    $secretBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
    [IO.File]::WriteAllText($passwordFile,[Convert]::ToBase64String($secretBytes))
  }
  $env:STUDIO_ANDROID_STORE_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
  Invoke-BuildTool (Join-Path $JdkRoot 'bin/keytool.exe') @('-genkeypair','-keystore',$keystore,'-storepass:env','STUDIO_ANDROID_STORE_PASSWORD','-keypass:env','STUDIO_ANDROID_STORE_PASSWORD','-alias','image-studio','-dname','CN=Image Studio,OU=Private Apps,O=Arcol','-keyalg','RSA','-keysize','3072','-validity','10000','-storetype','JKS')
}
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
