#!/usr/bin/env node
import { runCreate } from "@spicetify/kit/create";

try {
	await runCreate(process.argv.slice(2));
} catch (e) {
	console.error(e.message ?? e);
	process.exit(1);
}
