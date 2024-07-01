#!/usr/bin/env pwsh

[CmdletBinding()]
param (
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$Dirs
)

if ($Dirs.Count -eq 0) {
	$Dirs = Get-ChildItem -Directory modules
}

. .\scripts\VARS.ps1

foreach ($Dir in $Dirs) {
	$Id = Get-Id (Split-Path -Leaf $Dir)
	$Fid = Get-FullId (Split-Path -Leaf $Dir)
	Write-Host "Disabling $Fid"
	spicetify pkg enable "$Id@"
	spicetify pkg delete $Fid
}
