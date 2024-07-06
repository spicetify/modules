#!/usr/bin/env sh

get_id() {
	module=$1

	echo "$module"
}

get_fullId() {
	module=$1

	json=$(cat "modules/${module}/metadata.json")
	version=$(echo "${json}" | jq -r '.version')
	echo "$module@$version"
}
