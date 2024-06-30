#!/bin/sh

if [ $# -eq 0 ]; then
   set -- modules/*
fi

for DIR; do
   echo "Building ${DIR}"
	ID="/official/$(basename "$1")"
   deno run -A jsr:@delu/tailor/cli --module "${ID}" -i "${DIR}" -o "${DIR}" -c classmap.json -b &
done

wait

echo "Done"
