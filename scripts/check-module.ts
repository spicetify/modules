#!/usr/bin/env node
// Monorepo wrapper; the implementation lives in @spicetify/kit.
import { runCheck } from "../packages/kit/src/check.ts";

await runCheck(process.argv.slice(2)).catch((e) => {
	console.error(e.message ?? e);
	process.exit(1);
});
