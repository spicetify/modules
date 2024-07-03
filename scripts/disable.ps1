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
	$Module = Split-Path -Leaf $Dir
	$Id = Get-Id $Module
	$Fid = Get-FullId $Module
	Write-Host "Disabling $Fid"
	spicetify pkg enable $Id@
	spicetify pkg delete $Fid
}
