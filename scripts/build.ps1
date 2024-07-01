#!/usr/bin/env pwsh

[CmdletBinding()]
param (
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$Dirs
)

if ($Dirs.Count -eq 0) {
	$Dirs = Get-ChildItem -Directory modules
}

$jobs = @()

. .\scripts\VARS.ps1

foreach ($Dir in $Dirs) {
	$Id = Get-Id (Split-Path -Leaf $Dir)
	Write-Host "Building $Id"
	$jobs += Start-Process -FilePath "deno" -ArgumentList "run -A jsr:@delu/tailor/cli --module $Id -i $Dir -o $Dir -c classmap.json -b" -NoNewWindow -PassThru
}

$jobs | Wait-Process

Write-Host "Done"
