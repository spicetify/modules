#!/usr/bin/env sh

if [ $# -eq 0 ]; then
	set -- modules/*
fi

. ./scripts/VARS.sh

for DIR; do
	MODULE="$(basename "${DIR}")"
	ID="$(get_id "${MODULE}")"
	echo "Building ${ID}"
	deno run -A jsr:@delu/tailor/cli --module "${ID}" -i "${DIR}" -o "${DIR}" -c classmap.json -b &
done

wait

echo "Done"
