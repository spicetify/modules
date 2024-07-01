#!/usr/bin/env sh

get_id() {
	module=$1

	json=$(cat "modules/${module}/metadata.json")
	author=$(echo "${json}" | jq -r '.authors[0]')
	echo "/$author/$module"
}

get_fullId() {
	module=$1

	json=$(cat "modules/${module}/metadata.json")
	author=$(echo "${json}" | jq -r '.authors[0]')
	version=$(echo "${json}" | jq -r '.version')
	echo "/$author/$module@$version"
}
