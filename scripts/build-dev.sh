#!/bin/sh

if [ $# -eq 0 ]; then
   set -- modules/*
fi

for DIR; do
   echo "Building ${DIR}"
   deno run -A jsr:@delu/tailor/cli --module "/official/${DIR#*/}" -i "${DIR}" -o "${DIR}" -c classmap.json -b &
done

wait

echo "Done"
