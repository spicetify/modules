#!/usr/bin/env pwsh

[CmdletBinding()]
param (
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$Dirs
)

if ($Dirs.Count -eq 0) {
	$Dirs = Get-ChildItem -Directory modules
}

foreach ($Dir in $Dirs) {
	$Id = "/official/$(Split-Path -Leaf $Dir)@0.2.0"
	Write-Host "Enabling $Id"
	spicetify pkg delete $Id
	spicetify pkg install $Id $Dir
	spicetify pkg enable $Id
}
