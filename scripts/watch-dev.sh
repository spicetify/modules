#!/bin/env sh

if [ $# -eq 0 ]; then
   set -- modules/*
fi

for DIR; do
   echo "Watching ${DIR}"
   deno run -A jsr:@delu/tailor/cli --module "/official/${DIR#*/}" -i "${DIR}" -o "${DIR}" -c classmap.json -b -w --debounce 1000 --dev &
done

wait

echo "Done"
