import "../stdlib/lib/test-setup.mts";

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildModule } from "../../packages/kit/src/build.ts";

test("the built startup hook displays its image before any stdlib or React import", async (t) => {
	const directory = mkdtempSync(path.join(tmpdir(), "spicetify-splash-build-"));
	const input = path.join(directory, "source");
	cpSync(fileURLToPath(new URL("./", import.meta.url)), input, { recursive: true });
	const classmap = path.join(directory, "classmap.json");
	writeFileSync(classmap, "{}");
	let hooks: ReturnType<typeof registerHooks> | undefined;
	try {
		const built = await buildModule(
			input,
			path.join(directory, "dist"),
			{ path: classmap, key: "test" },
			process.cwd(),
		);
		hooks = registerHooks({
			resolve(specifier, context, nextResolve) {
				assert.ok(!specifier.startsWith("/modules/stdlib/"), "startup imported stdlib before Spotify booted");
				return nextResolve(specifier, context);
			},
		});
		t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
		const startup = await import(pathToFileURL(path.join(built, "index.js")).href);
		startup.mixin();
		const dialog = document.querySelector("dialog");
		assert.ok(dialog?.open);
		assert.equal(dialog.textContent.trim(), "");
		dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
		t.mock.timers.tick(200);
		assert.equal(document.querySelector("dialog"), null);
	} finally {
		hooks?.deregister();
		rmSync(directory, { recursive: true, force: true });
	}
});
