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
	$Fid = Get-FullId $Module
	Write-Host "Enabling $Fid"
	spicetify pkg install $Fid $Dir
	spicetify pkg enable $Fid
}
