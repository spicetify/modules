#!/usr/bin/env node
// Monorepo wrapper; the implementation lives in @spicetify/kit.
import { runBuild } from "../packages/kit/src/build.ts";

await runBuild(process.argv.slice(2)).catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
