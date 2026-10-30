[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$Pr
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $FilePath @Arguments 2>&1
    $code = $LASTEXITCODE
    return [pscustomobject]@{ Output = @($output); Code = $code }
  } finally {
    $ErrorActionPreference = $previous
  }
}

$prResult = Invoke-Native -FilePath "gh" -Arguments @("pr", "view", "$Pr", "--json", "body,url,state,title,mergedAt")
if ($prResult.Code -ne 0) {
  throw "Could not read PR #${Pr}: $($prResult.Output -join ' ')"
}

$prData = ($prResult.Output -join "`n") | ConvertFrom-Json
if ($prData.state -ne "MERGED") {
  throw "PR #$Pr is not merged (state: $($prData.state))."
}

$numbers = @(
  [regex]::Matches($prData.body, "(?im)\b(?:fixes|closes|resolves)\s+#(\d+)") |
    ForEach-Object { [int]$_.Groups[1].Value } |
    Select-Object -Unique
)

if ($numbers.Count -eq 0) {
  $closingResult = Invoke-Native -FilePath "gh" -Arguments @("pr", "view", "$Pr", "--json", "closingIssuesReferences")
  if ($closingResult.Code -eq 0) {
    $closing = ($closingResult.Output -join "`n") | ConvertFrom-Json
    $numbers = @($closing.closingIssuesReferences | ForEach-Object { [int]$_.number })
  }
}

if ($numbers.Count -eq 0) {
  throw "Could not find any 'Fixes #<issue>' lines in PR #$Pr."
}

foreach ($number in $numbers) {
  $viewResult = Invoke-Native -FilePath "gh" -Arguments @("issue", "view", "$number", "--json", "state,labels")
  if ($viewResult.Code -ne 0) {
    throw "Could not read issue #${number}: $($viewResult.Output -join ' ')"
  }
  $issueData = ($viewResult.Output -join "`n") | ConvertFrom-Json
  $labels = @($issueData.labels | ForEach-Object { $_.name })

  if ($issueData.state -eq "OPEN") {
    $comment = "Merged in PR #$Pr ($($prData.url))."
    $closeResult = Invoke-Native -FilePath "gh" -Arguments @("issue", "close", "$number", "--comment", $comment)
    if ($closeResult.Code -ne 0) {
      throw "Could not close issue #${number}: $($closeResult.Output -join ' ')"
    }
    Write-Host "Closed issue #$number."
  } else {
    Write-Host "Issue #$number was already closed by the merge."
  }

  if ($labels -notcontains "agent:merged") {
    Invoke-Native -FilePath "gh" -Arguments @("issue", "edit", "$number", "--add-label", "agent:merged") | Out-Null
  }
  if ($labels -contains "agent:working") {
    Invoke-Native -FilePath "gh" -Arguments @("issue", "edit", "$number", "--remove-label", "agent:working") | Out-Null
  }
  Write-Host "Marked issue #$number agent:merged."
}

Write-Host "Done. Merged PR #$Pr covers: #$($numbers -join ', #')"
