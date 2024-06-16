#!/usr/bin/env pwsh

[CmdletBinding()]
param (
   [string[]]$Dirs
)

if ($Dirs.Count -eq 0) {
   $Dirs = Get-ChildItem -Directory modules
}

foreach ($Dir in $Dirs) {
   $Id = "Delusoire/$(Split-Path -Leaf $Dir)@0.0.0-dev"
   Write-Host "Enabling $Id"
   spicetify pkg delete $Id
   spicetify pkg install $Id $Dir
   spicetify pkg enable $Id
}
