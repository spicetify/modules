#!/bin/env sh

if [ $# -eq 0 ]; then
   set -- modules/*
fi

for DIR; do
   echo "Watching ${DIR}"
	ID="/official/$(basename "$1")"
   SPICETIFY_CONFIG_DIR="$XDG_CONFIG_HOME/spicetify/" deno run -A jsr:@delu/tailor/cli --module "${ID}" -i "${DIR}" -o "${DIR}" -c classmap.json -b -w --debounce 1000 --dev &
done

wait

echo "Done"
