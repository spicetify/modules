#!/usr/bin/env pwsh

function Get-Id {
	param (
		[string]$module
	)

	$json = Get-Content -Path "modules\$module\metadata.json" -Raw | ConvertFrom-Json
	$Author = $json.authors[0]

	return "/$Author/$module"
}

function Get-FullId {
	param (
		[string]$module
	)

	$json = Get-Content -Path "modules\$module\metadata.json" -Raw | ConvertFrom-Json
	$Author = $json.authors[0]
	$Version = $json.version

	return "/$Author/$module@$Version"
}
