[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$BootstrapperUrl = "https://mirror.ctan.org/systems/texlive/tlnet/install-tl-windows.exe",
  [string]$ProfilePath = "$PSScriptRoot\..\profiles\texlive-full.profile",
  [string]$DownloadDirectory = "$env:TEMP\TeXWeave\texlive",
  [string]$ExpectedSha256
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DownloadDirectory | Out-Null
$installer = Join-Path $DownloadDirectory "install-tl-windows.exe"
Invoke-WebRequest -Uri $BootstrapperUrl -OutFile $installer -UseBasicParsing
if ($ExpectedSha256) {
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash
  if ($actual -ne $ExpectedSha256.ToUpperInvariant()) { throw "TeX Live bootstrapper checksum mismatch." }
}
if (-not (Test-Path -LiteralPath $ProfilePath)) { throw "TeX Live profile not found: $ProfilePath" }
if ($PSCmdlet.ShouldProcess("TeX Live", "Install using the downloaded official bootstrapper")) {
  $process = Start-Process -FilePath $installer -ArgumentList @("-profile", $ProfilePath) -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "TeX Live installer failed with exit code $($process.ExitCode)." }
}
