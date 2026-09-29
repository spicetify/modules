import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

describe("standalone Spicetify Settings", () => {
	it("ships compatible stdlib and settings contracts", () => {
		const stdlib = readJson("modules/stdlib/metadata.json");
		const lyricsPlus = readJson("modules/lyrics-plus/metadata.json");
		const kit = readJson("packages/kit/package.json");

		const installedMinor = Number(stdlib.version.match(/^1\.(\d+)\.\d+$/)?.[1]);
		const requiredMinor = Number(lyricsPlus.dependencies.stdlib.match(/^\^1\.(\d+)\.\d+$/)?.[1]);
		assert.ok(installedMinor >= requiredMinor, "Lyrics Plus must accept the installed stdlib");
		assert.equal(kit.spicetify.stdlibVersion, stdlib.version);
	});
});
