#!/usr/bin/env pwsh

function Get-Id {
	param (
		[string]$module
	)

	return "$module"
}

function Get-FullId {
	param (
		[string]$module
	)

	$json = Get-Content -Path "modules\$module\metadata.json" -Raw | ConvertFrom-Json
	$Version = $json.version

	return "$module@$Version"
}
