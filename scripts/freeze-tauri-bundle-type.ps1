param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'

$resolvedPath = (Resolve-Path -LiteralPath $ExecutablePath).Path
$placeholder = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_UNK')
$replacement = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_NSS')

if ($placeholder.Length -ne $replacement.Length) {
  throw 'The Tauri bundle markers must have equal lengths.'
}

function Find-ByteSequence {
  param(
    [byte[]]$Bytes,
    [byte[]]$Sequence
  )

  $matches = [Collections.Generic.List[int]]::new()
  for ($offset = 0; $offset -le $Bytes.Length - $Sequence.Length; $offset++) {
    $matched = $true
    for ($index = 0; $index -lt $Sequence.Length; $index++) {
      if ($Bytes[$offset + $index] -ne $Sequence[$index]) {
        $matched = $false
        break
      }
    }
    if ($matched) {
      $matches.Add($offset)
      $offset += $Sequence.Length - 1
    }
  }
  return $matches.ToArray()
}

$bytes = [IO.File]::ReadAllBytes($resolvedPath)
$placeholderMatches = @(Find-ByteSequence -Bytes $bytes -Sequence $placeholder)
$replacementMatches = @(Find-ByteSequence -Bytes $bytes -Sequence $replacement)

if ($placeholderMatches.Count -ne 1) {
  throw "Expected exactly one unpatched Tauri bundle marker, found $($placeholderMatches.Count)."
}
if ($replacementMatches.Count -ne 0) {
  throw "The executable already contains $($replacementMatches.Count) frozen bundle marker(s)."
}

[Array]::Copy(
  $replacement,
  0,
  $bytes,
  $placeholderMatches[0],
  $replacement.Length
)
[IO.File]::WriteAllBytes($resolvedPath, $bytes)

$verifiedBytes = [IO.File]::ReadAllBytes($resolvedPath)
if (@(Find-ByteSequence -Bytes $verifiedBytes -Sequence $placeholder).Count -ne 0 -or
    @(Find-ByteSequence -Bytes $verifiedBytes -Sequence $replacement).Count -ne 1) {
  throw 'Could not verify the frozen Tauri bundle marker.'
}

Write-Host "Frozen Tauri bundle marker in: $resolvedPath"
