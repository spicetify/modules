#!/usr/bin/env pwsh

[CmdletBinding()]
param (
   [string[]]$Dirs
)

if ($Dirs.Count -eq 0) {
   $Dirs = Get-ChildItem -Directory modules
}

$jobs = @()

foreach ($Dir in $Dirs) {
   Write-Host "Watching $Dir"
   $jobs += Start-Process -FilePath "deno" -ArgumentList "run -A jsr:@delu/tailor/cli -i $Dir -o $Dir -c classmap.json -w" -NoNewWindow -PassThru
}

$jobs | Wait-Process

Write-Host "Done"
