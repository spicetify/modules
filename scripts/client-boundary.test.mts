import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { checkSource } from "../packages/kit/src/check.ts";

const modulesRoot = path.resolve("modules");

function sourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory)) {
		const absolute = path.join(directory, entry);
		if (statSync(absolute).isDirectory()) {
			files.push(...sourceFiles(absolute));
			continue;
		}
		if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") && !/\.test\.[cm]?tsx?$/.test(entry)) {
			files.push(absolute);
		}
	}
	return files;
}

test("hosted extensions use the stdlib client capability boundary", () => {
	const violations: string[] = [];
	for (const entry of readdirSync(modulesRoot)) {
		const directory = path.join(modulesRoot, entry);
		if (!statSync(directory).isDirectory()) continue;
		const metadata = JSON.parse(readFileSync(path.join(directory, "metadata.json"), "utf8"));
		if (metadata.kind !== "extension") continue;

		for (const file of sourceFiles(directory)) {
			const relative = path.relative(directory, file);
			for (const finding of checkSource(relative, readFileSync(file, "utf8"))) {
				if (finding.rule === "client-capabilities") violations.push(`${entry}/${finding.file}`);
			}
		}
	}

	assert.deepEqual(violations, []);
});
