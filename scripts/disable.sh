#!/usr/bin/env sh

if [ $# -eq 0 ]; then
	set -- modules/*
fi

. ./scripts/VARS.sh

for DIR; do
	MODULE="$(basename "${DIR}")"
	ID="$(get_id "${MODULE}")"
	FID="$(get_fullId "${MODULE}")"
	echo "Disabling ${FID}"
	spicetify pkg enable "${ID}@"
	spicetify pkg delete "${FID}"
done
