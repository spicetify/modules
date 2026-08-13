import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

describe("standalone Spicetify Settings", () => {
	it("owns a bespoke route instead of injecting into Spotify preferences", () => {
		const source = read("modules/stdlib/src/registers/settingsSection.ts");
		assert.match(source, /SPICETIFY_SETTINGS_ROUTE\s*=\s*"\/bespoke\/settings"/);
		assert.doesNotMatch(source, /\.x-settings-container/);
	});

	it("renders ordinary settings before footer actions", () => {
		const source = read("modules/stdlib/src/registers/settingsSection.ts");
		const sections = source.indexOf("sections.map");
		const actions = source.indexOf("actions.map");
		assert.ok(sections >= 0, "the page must render registered sections");
		assert.ok(actions > sections, "settings actions, including Manager, must render last");
	});

	it("remounts the route page per path so settings opens at the top", () => {
		const source = read("modules/stdlib/src/registers/route.ts");
		assert.match(source, /key:\s*route\.props\.path/);
	});

	it("makes Manager the final settings action and sends the profile shortcut to settings", () => {
		const mod = read("modules/manager/mod.tsx");
		const menuItem = read("modules/manager/menuItem.tsx");
		assert.match(mod, /register\("settingsAction"/);
		assert.match(menuItem, /SPICETIFY_SETTINGS_ROUTE/);
		assert.doesNotMatch(menuItem, /push\(MANAGER_ROUTE\)/);
	});

	it("registers Lyrics Plus settings at module load without a profile-menu item", () => {
		const mod = read("modules/lyrics-plus/mod.tsx");
		const settings = read("modules/lyrics-plus/settings.tsx");
		assert.match(mod, /register\(\s*"settingsSection"/);
		assert.match(mod, /LyricsPlusSettings/);
		assert.match(settings, /export (?:const|function) LyricsPlusSettings/);
		assert.doesNotMatch(mod, /new Spicetify\.Menu\.Item\("Lyrics Plus config"/);
	});

	it("ships the new settings contracts as minor releases", () => {
		const stdlib = readJson("modules/stdlib/metadata.json");
		const manager = readJson("modules/manager/metadata.json");
		const lyricsPlus = readJson("modules/lyrics-plus/metadata.json");
		const kit = readJson("packages/kit/package.json");

		assert.equal(stdlib.version, "1.6.0");
		assert.equal(manager.version, "1.2.0");
		assert.equal(manager.dependencies.stdlib, "^1.6.0");
		assert.equal(lyricsPlus.version, "0.2.0");
		assert.equal(kit.spicetify.stdlibVersion, stdlib.version);
	});
});
