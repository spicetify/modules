#!/usr/bin/env sh

if [ $# -eq 0 ]; then
	set -- modules/*
fi

. ./scripts/VARS.sh

for DIR; do
	MODULE="$(basename "${DIR}")"
	FID="$(get_fullId "${MODULE}")"
	echo "Enabling ${FID}"
	spicetify pkg install "${FID}" "${DIR}"
	spicetify pkg enable "${FID}"
done
