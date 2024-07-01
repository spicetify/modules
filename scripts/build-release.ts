import build from "./build-shared.ts";
import { classmapInfos } from "./classmap-info.ts";

await build(classmapInfos, Deno.args);
