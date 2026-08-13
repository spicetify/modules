import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

describe("standalone Spicetify Settings", () => {
	it("owns a bespoke route instead of injecting into Spotify preferences", () => {
		const source = read("modules/stdlib/src/registers/settingsSection.ts");
		assert.match(source, /SPICETIFY_SETTINGS_ROUTE\s*=\s*"\/bespoke\/settings"/);
		assert.doesNotMatch(source, /querySelector\(["']\.x-settings-container/);
	});

	it("reuses Spotify's Settings width and typography contracts", () => {
		const page = read("modules/stdlib/src/registers/settingsSection.ts");
		const primitives = read("modules/stdlib/lib/primitives.tsx");
		const classes = read("modules/stdlib/lib/primitives-classes.ts");
		const styles = read("modules/stdlib/index.scss");

		assert.match(page, /spicetify-settings-page x-settings-container/);
		assert.match(page, /SETTINGS_HEADER_CONTAINER_CLASS/);
		assert.match(page, /SETTINGS_HEADER_CLASS/);
		assert.match(primitives, /SETTINGS_SECTION_HEADING_CLASS/);
		assert.match(primitives, /SETTINGS_ROW_TEXT_CLASS/);
		assert.match(classes, /encore-text-title-medium/);
		assert.match(classes, /encore-text-body-medium-bold/);
		assert.match(classes, /encore-text-body-small/);
		assert.match(styles, /\.spicetify-settings-page\.x-settings-container\s*\{[^}]*max-width:\s*900px/s);
		assert.match(styles, /\.spicetify-settings-page\.x-settings-container\s*\{[^}]*padding:\s*32px/s);
		assert.match(styles, /\.spicetify-settings-page\s+\.x-settings-row\s*\{[^}]*grid-template-columns:\s*2fr 1fr/s);
		assert.match(styles, /\.spicetify-settings-page\s+\.x-settings-section\s*\{[^}]*gap:\s*8px/s);
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

	it("renders every Lyrics Plus boolean as Spotify's native toggle", () => {
		const settings = read("modules/lyrics-plus/settings.tsx");
		const styles = read("modules/lyrics-plus/index.scss");
		const toggles = [...settings.matchAll(/react\.createElement\(Toggle/g)];

		assert.ok(toggles.length >= 2, "visual options and provider switches must both use Toggle");
		assert.doesNotMatch(settings, /Spicetify\.SVGIcons\.check/);
		assert.match(styles, /input:not\(\[type=["']checkbox["']\]\)/);
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
