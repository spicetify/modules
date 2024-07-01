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
	$Fid = Get-FullId (Split-Path -Leaf $Dir)
	Write-Host "Enabling $Fid"
	spicetify pkg install $Fid $Dir
	spicetify pkg enable $Fid
}
