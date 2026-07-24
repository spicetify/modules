#!/usr/bin/env node
// Monorepo wrapper; the implementation lives in @spicetify/kit.
import { runCreate } from "../packages/kit/src/create.ts";

await runCreate([...process.argv.slice(2), "--bare"]).catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
