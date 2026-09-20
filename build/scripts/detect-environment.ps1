[CmdletBinding()]
param(
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$tools = @("latexmk", "pdflatex", "xelatex", "lualatex", "bibtex", "biber", "makeindex")
$found = @{}
foreach ($tool in $tools) {
  $command = Get-Command $tool -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    $found[$tool] = [ordered]@{ path = $command.Source; version = (& $command.Source --version 2>$null | Select-Object -First 1) }
  }
}

$roots = @(
  "$env:ProgramFiles\MiKTeX",
  "$env:ProgramFiles\texlive",
  "$env:LOCALAPPDATA\Programs\MiKTeX",
  "$env:USERPROFILE\AppData\Local\Programs\MiKTeX"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$result = [ordered]@{
  schemaVersion = 1
  checkedAt = [DateTime]::UtcNow.ToString("o")
  platform = "windows"
  tools = $found
  candidateRoots = @($roots)
  ready = ($null -ne $found["latexmk"] -and ($null -ne $found["pdflatex"] -or $null -ne $found["xelatex"] -or $null -ne $found["lualatex"]))
}
$json = $result | ConvertTo-Json -Depth 6
if ($OutputPath) { $json | Set-Content -LiteralPath $OutputPath -Encoding UTF8 }
$json
