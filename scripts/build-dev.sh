#!/bin/sh

if [ $# -eq 0 ]; then
   set -- modules/*
fi

for DIR; do
   echo "Building ${DIR}"
   deno run -A jsr:@delu/tailor/cli -i "${DIR}" -o "${DIR}" -c classmap.json -b &
done

wait

echo "Done"
