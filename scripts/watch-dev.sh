#!/bin/env sh

if [ $# -eq 0 ]; then
   set -- modules/*
fi

for DIR; do
   echo "Watching ${DIR}"
   deno run -A jsr:@delu/tailor/cli -i "${DIR}" -o "${DIR}" -c classmap.json -w &
done

wait

echo "Done"
