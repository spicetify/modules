/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Everything here is pure: colour maths, ini parsing, png comparison, and the
// source-level contract that holds scheme handling to the client loader. The
// capture half needs a running Spotify and is exercised by running the tool.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { PNG } from "pngjs";

import {
	auditAll,
	auditScheme,
	auditTheme,
	comparePng,
	contrastRatio,
	DERIVED_COLORS,
	fillCanonical,
	hexToRgb,
	listSchemes,
	MIN_RATIO,
	parseColorSchemes,
	relativeLuminance,
	resolveScheme,
	schemeVars,
	THEMED_CLASS,
} from "./theme-report.ts";

const roots: string[] = [];

function tmp(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "theme-report-"));
	roots.push(dir);
	return dir;
}

function themeWith(ini: string): string {
	const dir = tmp();
	writeFileSync(path.join(dir, "color.ini"), ini);
	return dir;
}

/** A themes/ directory holding one theme per entry. */
function themesDir(themes: Record<string, string>): string {
	const root = tmp();
	for (const [name, ini] of Object.entries(themes)) {
		mkdirSync(path.join(root, name), { recursive: true });
		writeFileSync(path.join(root, name, "color.ini"), ini);
	}
	return root;
}

/** A solid image, optionally with one differently-coloured block. */
function png(
	width: number,
	height: number,
	fill: [number, number, number],
	block?: { x: number; y: number; w: number; h: number; colour: [number, number, number] },
): Buffer {
	const image = new PNG({ width, height });
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const inBlock = block && x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h;
			const [r, g, b] = inBlock ? block.colour : fill;
			const i = (width * y + x) << 2;
			image.data[i] = r;
			image.data[i + 1] = g;
			image.data[i + 2] = b;
			image.data[i + 3] = 255;
		}
	}
	return PNG.sync.write(image);
}

after(() => {
	for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/* ------------------------------------------------------ scheme resolution */

describe("parseColorSchemes", () => {
	it("splits sections, lowercases keys, and preserves section case", () => {
		const schemes = parseColorSchemes("[Dark Mode]\nGradientTop = 000000\ntext = FFFFFF\n");
		assert.deepEqual(Object.keys(schemes), ["Dark Mode"]);
		assert.deepEqual(schemes["Dark Mode"], { gradienttop: "000000", text: "FFFFFF" });
	});

	it("files keys before any section under the empty-string scheme", () => {
		const schemes = parseColorSchemes("text = FFFFFF\nmain = 000000\n");
		assert.deepEqual(Object.keys(schemes), [""]);
	});

	it("strips inline and whole-line comments", () => {
		assert.equal(parseColorSchemes("; a\n# b\nmain = 000000 ; the sky\n")[""].main, "000000");
	});

	it("drops sections that declare nothing", () => {
		assert.deepEqual(Object.keys(parseColorSchemes("[Empty]\n[Real]\ntext = FFFFFF\n")), ["Real"]);
	});
});

describe("fillCanonical", () => {
	it("derives card from main when neither card nor main-elevated is declared", () => {
		assert.equal(fillCanonical({ main: "121212", text: "FFFFFF" }).card, "121212");
	});

	it("never overwrites a declared key", () => {
		assert.equal(fillCanonical({ main: "121212", card: "202020" }).card, "202020");
	});

	it("derives selected-row from text, which is why contrast skips derived pairs", () => {
		assert.equal(fillCanonical({ main: "121212", text: "FFFFFF" })["selected-row"], "FFFFFF");
	});
});

describe("hexToRgb and schemeVars", () => {
	it("expands a three-digit hex", () => {
		assert.equal(hexToRgb("fff"), "255,255,255");
	});

	it("accepts a leading hash and rejects nonsense", () => {
		assert.equal(hexToRgb("#1ed760"), "30,215,96");
		assert.equal(hexToRgb("not-a-colour"), null);
	});

	it("adds a missing hash and emits the matching rgb triple", () => {
		const vars = schemeVars({ main: "121212" });
		assert.equal(vars["--spice-main"], "#121212");
		assert.equal(vars["--spice-rgb-main"], "18,18,18");
	});

	it("emits the property but no rgb triple for a malformed value", () => {
		const vars = schemeVars({ main: "rgba(0,0,0,.5)" });
		assert.equal(vars["--spice-main"], "#rgba(0,0,0,.5)");
		assert.equal(vars["--spice-rgb-main"], undefined);
	});
});

describe("resolveScheme", () => {
	it("picks the first scheme when none is named", () => {
		assert.equal(resolveScheme(themeWith("[One]\nmain = 000000\n[Two]\nmain = FFFFFF\n"))?.name, "One");
	});

	it("separates declared keys from derived ones", () => {
		const scheme = resolveScheme(themeWith("[Base]\nmain = 121212\ntext = FFFFFF\n"));
		assert.equal(scheme?.declared.card, undefined);
		assert.equal(scheme?.resolved.card, "121212");
	});

	it("throws with the available names when the requested scheme is absent", () => {
		assert.throws(() => resolveScheme(themeWith("[One]\nmain = 000000\n"), "Nope"), /has no scheme "Nope".*One/s);
	});

	it("returns null for a placeholder color.ini that declares nothing", () => {
		assert.equal(resolveScheme(themeWith("; empty\n\n[turntable]\n")), null);
	});

	it("returns null when the theme has no color.ini", () => {
		assert.equal(resolveScheme(tmp()), null);
	});
});

describe("listSchemes", () => {
	it("returns names in file order", () => {
		assert.deepEqual(listSchemes(themeWith("[One]\nmain = 000000\n[Two]\nmain = FFFFFF\n")), ["One", "Two"]);
	});

	it("returns nothing for a directory with no color.ini", () => {
		assert.deepEqual(listSchemes(tmp()), []);
	});
});

/* ------------------------------------------ parity with the client loader */

// Drift here is silent and total: a derivation the loader gained and this copy
// lacks makes every capture subtly wrong while every other test still passes.
// The loader is a sibling checkout, so where it is absent this skips loudly.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.dirname(path.dirname(HERE));
const LOADER = path.join(WORKSPACE, "cli", "src", "jsHelper", "modularLoader", "index.ts");
const SKIP = `loader not found at ${path.relative(WORKSPACE, LOADER)} - check out the cli repo beside this one`;

const loaderSource = () => (existsSync(LOADER) ? readFileSync(LOADER, "utf8") : null);

function extractDerivedColors(source: string): Array<[string, string[]]> {
	const start = source.indexOf("const DERIVED_COLORS");
	assert.notEqual(start, -1, "loader no longer declares DERIVED_COLORS - the contract needs updating");
	const block = source.slice(start, source.indexOf("\n];", start));
	return [...block.matchAll(/\["([^"]+)",\s*\[([^\]]*)\]\]/g)].map((m) => [
		m[1],
		[...m[2].matchAll(/"([^"]+)"/g)].map((s) => s[1]),
	]);
}

describe("scheme parity with the client loader", () => {
	it("derivation table matches, entry for entry and in order", (t) => {
		const source = loaderSource();
		if (!source) return t.skip(SKIP);
		assert.deepEqual(extractDerivedColors(source), DERIVED_COLORS);
	});

	it("themed marker class matches", (t) => {
		const source = loaderSource();
		if (!source) return t.skip(SKIP);
		assert.match(source, new RegExp(`THEMED_CLASS\\s*=\\s*"${THEMED_CLASS}"`));
	});

	it("custom properties are named --spice-<key> with an rgb companion", (t) => {
		const source = loaderSource();
		if (!source) return t.skip(SKIP);
		assert.match(source, /`--spice-\$\{key\}`/);
		assert.match(source, /`--spice-rgb-\$\{key\}`/);
	});

	it("values gain a leading hash only when they lack one", (t) => {
		const source = loaderSource();
		if (!source) return t.skip(SKIP);
		assert.match(source, /value\.startsWith\("#"\)\s*\?\s*value\s*:\s*`#\$\{value\}`/);
	});

	it("keys are lowercased while section names keep their case", (t) => {
		const source = loaderSource();
		if (!source) return t.skip(SKIP);
		assert.match(source, /slice\(0, eq\)\.trim\(\)\.toLowerCase\(\)/);
		assert.match(source, /section\[1\]\.trim\(\)/);
	});
});

describe("the parity extractor itself", () => {
	it("reads a derivation table out of source text", () => {
		const synthetic = `const DERIVED_COLORS: Array<[string, string[]]> = [\n\t["a", ["b"]],\n\t["c", ["d", "e"]],\n];\n`;
		assert.deepEqual(extractDerivedColors(synthetic), [
			["a", ["b"]],
			["c", ["d", "e"]],
		]);
	});

	it("notices an entry this copy would be missing", () => {
		const drifted = `const DERIVED_COLORS: Array<[string, string[]]> = [\n\t["a", ["b"]],\n\t["new", ["a"]],\n];\n`;
		assert.notDeepEqual(extractDerivedColors(drifted), [["a", ["b"]]]);
	});
});

/* --------------------------------------------------------- contrast audit */

describe("contrast maths", () => {
	it("puts black on white at the 21:1 ceiling", () => {
		assert.equal(Math.round(contrastRatio("0,0,0", "255,255,255")), 21);
	});

	it("puts a colour against itself at the 1:1 floor", () => {
		assert.equal(contrastRatio("18,18,18", "18,18,18"), 1);
	});

	it("is symmetric regardless of which colour is foreground", () => {
		assert.equal(contrastRatio("30,215,96", "18,18,18"), contrastRatio("18,18,18", "30,215,96"));
	});

	it("orders luminance from black through grey to white", () => {
		assert.ok(relativeLuminance("0,0,0") < relativeLuminance("128,128,128"));
		assert.ok(relativeLuminance("128,128,128") < relativeLuminance("255,255,255"));
	});
});

describe("pair selection", () => {
	it("passes a high-contrast declared pair", () => {
		const audit = auditScheme("t", "s", { text: "FFFFFF", main: "000000" });
		assert.equal(audit.findings.length, 0);
		assert.ok(audit.evaluated > 0);
	});

	it("reports a low-contrast declared pair with its measured ratio", () => {
		const finding = auditScheme("t", "s", { text: "777777", main: "808080" }).findings.find(
			(f) => f.pair === "text on main",
		);
		assert.ok(finding);
		assert.ok(finding.ratio < MIN_RATIO);
	});

	it("skips a pair whose background the theme never declares", () => {
		// selected-row derives from text, so a naive check would score 1:1.
		const audit = auditScheme("t", "s", { text: "FFFFFF", main: "000000" });
		assert.ok(!audit.findings.some((f) => f.bgKey === "selected-row"));
		assert.ok(audit.skipped > 0);
	});

	it("does not judge a derived card as an authored choice", () => {
		const audit = auditScheme("t", "s", { text: "FFFFFF", main: "FFFFFE" });
		assert.ok(!audit.findings.some((f) => f.bgKey === "card"));
	});

	it("evaluates a declared card even when it is nearly the text colour", () => {
		const audit = auditScheme("t", "s", { text: "FFFFFF", main: "000000", card: "FEFEFE" });
		assert.ok(audit.findings.some((f) => f.bgKey === "card"));
	});

	it("prefers a surface-specific foreground over the general one", () => {
		const audit = auditScheme("t", "s", { text: "111111", "sidebar-text": "FFFFFF", sidebar: "000000" });
		assert.equal(
			audit.findings.find((f) => f.bgKey === "sidebar"),
			undefined,
		);
	});

	it("falls back to the general foreground when no specific one is declared", () => {
		const sidebar = auditScheme("t", "s", { text: "111111", sidebar: "000000" }).findings.find(
			(f) => f.bgKey === "sidebar",
		);
		assert.equal(sidebar?.fgKey, "text");
	});

	it("contributes neither result nor error when neither key is declared", () => {
		const audit = auditScheme("t", "s", { button: "1ED760" });
		assert.equal(audit.evaluated, 0);
		assert.equal(audit.findings.length, 0);
		assert.equal(audit.malformed.length, 0);
	});
});

describe("malformed colours", () => {
	it("reports an unparseable value separately from a contrast failure", () => {
		const audit = auditScheme("t", "s", { text: "not-a-colour", main: "000000" });
		assert.equal(audit.malformed.length, 1);
		assert.equal(audit.findings.length, 0);
	});

	it("does not count a malformed pair as evaluated", () => {
		assert.equal(auditScheme("t", "s", { text: "zzz", main: "000000" }).evaluated, 0);
	});
});

describe("whole-theme and multi-theme audits", () => {
	it("covers every scheme, not just the first", () => {
		const root = themesDir({
			multi: "[Good]\ntext = FFFFFF\nmain = 000000\n[Bad]\ntext = 777777\nmain = 808080\n",
		});
		const audit = auditTheme(root, "multi");
		assert.ok(audit.findings.some((f) => f.scheme === "Bad"));
		assert.ok(!audit.findings.some((f) => f.scheme === "Good"));
	});

	it("labels a section-less file as the default scheme", () => {
		const root = themesDir({ flat: "text = 777777\nmain = 808080\n" });
		assert.equal(auditTheme(root, "flat").findings[0]?.scheme, "(default)");
	});

	it("returns nothing for a placeholder ini that declares no colours", () => {
		const root = themesDir({ placeholder: "; nothing\n[placeholder]\n" });
		assert.equal(auditTheme(root, "placeholder").evaluated, 0);
	});

	it("aggregates across themes and can be narrowed to named ones", () => {
		const root = themesDir({
			alpha: "[a]\ntext = 777777\nmain = 808080\n",
			beta: "[b]\ntext = 707070\nmain = 787878\n",
		});
		assert.equal(new Set(auditAll(root).findings.map((f) => f.theme)).size, 2);
		assert.deepEqual([...new Set(auditAll(root, ["alpha"]).findings.map((f) => f.theme))], ["alpha"]);
	});
});

/* -------------------------------------------------------- png comparison */

describe("comparePng", () => {
	it("finds no change between identical images", () => {
		const result = comparePng(png(40, 40, [0, 0, 0]), png(40, 40, [0, 0, 0]));
		assert.equal(result.changedPixels, 0);
		assert.equal(result.changedRatio, 0);
		assert.equal(result.mismatch, undefined);
	});

	it("counts the pixels of a changed region", () => {
		const result = comparePng(
			png(40, 40, [0, 0, 0]),
			png(40, 40, [0, 0, 0], { x: 0, y: 0, w: 10, h: 10, colour: [255, 255, 255] }),
		);
		assert.equal(result.changedPixels, 100);
		assert.equal(result.totalPixels, 1600);
	});

	it("produces a delta image when the two differ", () => {
		const result = comparePng(png(20, 20, [0, 0, 0]), png(20, 20, [255, 255, 255]));
		assert.ok(result.delta && result.delta.length > 0);
	});

	it("reports differing dimensions as a mismatch, not a pixel count", () => {
		// Comparing the overlap would score a render that shifted everything by
		// one row as almost identical.
		const result = comparePng(png(40, 40, [0, 0, 0]), png(40, 41, [0, 0, 0]));
		assert.match(result.mismatch ?? "", /40x40.*40x41/);
		assert.equal(result.delta, null);
	});
});
