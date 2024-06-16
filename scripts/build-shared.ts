import { readJSON } from "jsr:@delu/tailor";

export const classmapInfos = [
   {
      classmap: await readJSON("classmap.json"),
      version: "1.2.38",
      timestamp: 1675203200,
   },
];
