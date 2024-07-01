#!/usr/bin/env sh

if [ $# -eq 0 ]; then
	set -- modules/*
fi

. ./scripts/VARS.sh

for DIR; do
	MODULE="$(basename "${DIR}")"
	ID="$(get_id "${MODULE}")"
	echo "Watching ${ID}"
	SPICETIFY_CONFIG_DIR="$XDG_CONFIG_HOME/spicetify/" deno run -A jsr:@delu/tailor/cli --module "${ID}" -i "${DIR}" -o "${DIR}" -c classmap.json -b -w --debounce 1000 --dev &
done

wait

echo "Done"
