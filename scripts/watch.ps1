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

$env:SPICETIFY_CONFIG_DIR = "$env:LOCALAPPDATA\spicetify\"

. .\scripts\VARS.ps1

foreach ($Dir in $Dirs) {
	$Module = Split-Path -Leaf $Dir
	$Id = Get-Id $Module
	Write-Host "Watching $Id"
	$jobs += Start-Process -FilePath "deno" -ArgumentList "run -A jsr:@delu/tailor/cli --module `"$Id`" -i `"$Dir`" -o `"$Dir`" -c classmap.json -b -w --debounce 1000 --dev" -NoNewWindow -PassThru
}

$jobs | Wait-Process

Write-Host "Done"
