#!/usr/bin/env node
// Monorepo wrapper; the implementation lives in @spicetify/kit.
import { runDev } from "../packages/kit/src/dev.ts";

await runDev(process.argv.slice(2)).catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
