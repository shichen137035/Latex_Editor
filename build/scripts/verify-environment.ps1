[CmdletBinding()]
param(
  [string]$BinDirectory,
  [string]$Latexmk
)

$ErrorActionPreference = "Stop"
$tools = @("latexmk", "pdflatex", "xelatex", "lualatex", "bibtex", "biber", "makeindex")
$result = [ordered]@{}
foreach ($tool in $tools) {
  $candidate = $null
  if ($BinDirectory) { $candidate = Join-Path $BinDirectory "$tool.exe" }
  if ($tool -eq "latexmk" -and $Latexmk) { $candidate = $Latexmk }
  if ($candidate -and (Test-Path -LiteralPath $candidate)) { $result[$tool] = $candidate; continue }
  $command = Get-Command $tool -ErrorAction SilentlyContinue
  if ($command) { $result[$tool] = $command.Source }
}
$ready = $result.Contains("latexmk") -and ($result.Contains("pdflatex") -or $result.Contains("xelatex") -or $result.Contains("lualatex"))
[ordered]@{ schemaVersion = 1; checkedAt = [DateTime]::UtcNow.ToString("o"); ready = $ready; tools = $result } | ConvertTo-Json -Depth 5
if (-not $ready) { exit 2 }
