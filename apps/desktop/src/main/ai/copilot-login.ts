export interface CopilotLoginResult { exitCode: number; error?: string }

/** A real UTF-8/BOM PowerShell script; completion is recorded before the console closes. */
export function createCopilotLoginScript(cli: string, home: string, resultPath: string): string {
  return "\ufeff" + [
    "$ErrorActionPreference = 'Stop'",
    "$loginExitCode = 1",
    "$loginError = $null",
    "try {",
    `  $env:COPILOT_HOME = '${escapePowerShell(home)}'`,
    `  & '${escapePowerShell(cli)}' login --web-flow`,
    "  if ($null -ne $LASTEXITCODE) { $loginExitCode = $LASTEXITCODE }",
    "} catch {",
    "  $loginError = $_.Exception.Message",
    "  Write-Host $loginError -ForegroundColor Red",
    "} finally {",
    `  @{ exitCode = $loginExitCode; error = $loginError } | ConvertTo-Json -Compress | Set-Content -LiteralPath '${escapePowerShell(resultPath)}' -Encoding UTF8`,
    "}",
    "if ($loginExitCode -ne 0) { Write-Host \"Copilot login exited with code $loginExitCode.\" -ForegroundColor Red }",
    "Write-Host ''",
    "Read-Host 'Login finished. Press Enter to close this window' | Out-Null"
  ].join("\r\n");
}

export function createCopilotLoginLaunchCommand(scriptPath: string): string {
  // Start-Process joins ArgumentList into a native command line; quote the file
  // path there as well as escaping the outer PowerShell string.
  const argumentsText = `-NoLogo -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
  return `Start-Process -FilePath 'powershell.exe' -WindowStyle Normal -ArgumentList '${escapePowerShell(argumentsText)}' -ErrorAction Stop | Out-Null`;
}

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''");
}
