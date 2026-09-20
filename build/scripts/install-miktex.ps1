[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$Arguments = "--unattended=yes"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "MiKTeX installer not found: $InstallerPath" }
if ($PSCmdlet.ShouldProcess("MiKTeX", "Install using the selected bootstrapper")) {
  $process = Start-Process -FilePath $InstallerPath -ArgumentList $Arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "MiKTeX installer failed with exit code $($process.ExitCode)." }
}
