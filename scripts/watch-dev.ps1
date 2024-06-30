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
	$Id = $Dir -replace ".*\\modules\\", "/official/"
	$jobs += Start-Process -FilePath "deno" -ArgumentList "run -A jsr:@delu/tailor/cli --module $Id -i $Dir -o $Dir -c classmap.json -b -w --debounce 1000 --dev" -NoNewWindow -PassThru
}

$jobs | Wait-Process

Write-Host "Done"
