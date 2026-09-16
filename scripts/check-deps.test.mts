import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkDependencies } from "./check-deps.ts";

test("dependency gate checks runtime declarations and ranges together, retaining compat support", () => {
	const root = mkdtempSync(path.join(tmpdir(), "check-deps-"));
	const write = (id: string, metadata: object, source: string) => {
		const directory = path.join(root, "modules", id);
		mkdirSync(directory, { recursive: true });
		writeFileSync(path.join(directory, "metadata.json"), JSON.stringify({ name: id, ...metadata }));
		writeFileSync(path.join(directory, "mod.ts"), source);
	};
	try {
		write("library", { version: "2.0.0", compat: ["1.0.0"] }, "export const value = 1;");
		write(
			"consumer",
			{ version: "1.0.0", dependencies: { library: "^1.0.0" } },
			'import "/modules/library/mod.js";',
		);
		assert.deepEqual(checkDependencies(root).findings, []);
		write(
			"consumer",
			{ version: "1.0.0", dependencies: { library: "^3.0.0" } },
			'import "/modules/library/mod.js";',
		);
		assert.match(checkDependencies(root).findings.join("\n"), /consumer needs library@\^3.0.0/);
		write("consumer", { version: "1.0.0" }, 'import "/modules/library/mod.js";');
		assert.match(checkDependencies(root).findings.join("\n"), /missing-module-dependency/);
		write("consumer", { version: "1.0.0", dependencies: ["library"] }, 'import "/modules/library/mod.js";');
		assert.deepEqual(checkDependencies(root).findings, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
