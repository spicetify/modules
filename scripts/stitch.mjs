#!/usr/bin/env node
/**
 * stitch - build v3 modules for the spicetify modular runtime.
 *
 * Bundles each module with rolldown (TS/TSX, code-split lazy chunks),
 * compiles SCSS entries, and writes dist/<name>@<version>/ with
 * metadata.json and the spicetify-module.json sidecar.
 *
 * Modules ship MAP-intact: class references are remapped by the CLI at
 * apply time against the exact installed classmap, so one build serves
 * every supported Spotify version.
 */

import { rolldown } from "rolldown";
import * as sass from "sass-embedded";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MODULES_DIR = path.join(ROOT, "modules");
const DIST_DIR = path.join(ROOT, "dist");

const EXTERNALS = [/^\/hooks\//, /^https?:\/\//];

function readMetadata(dir) {
	return JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf8"));
}

function sidecar(metadata, classmapKey) {
	return {
		installed_version: metadata.version,
		classmap_base: classmapKey,
		allow_stale: false,
	};
}

async function buildJs(inputDir, outputDir, identifier) {
	const bundle = await rolldown({
		input: path.join(inputDir, "index.ts"),
		external: EXTERNALS,
		resolve: {
			extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
		},
	});
	await bundle.write({
		dir: outputDir,
		format: "esm",
		sourcemap: true,
	});
}

function buildCss(inputDir, outputDir) {
	const scss = path.join(inputDir, "index.scss");
	const css = path.join(inputDir, "index.css");
	if (existsSync(scss)) {
		const result = sass.compile(scss, { style: "compressed" });
		writeFileSync(path.join(outputDir, "index.css"), result.css);
		return "index.css";
	}
	if (existsSync(css)) {
		cpSync(css, path.join(outputDir, "index.css"));
		return "index.css";
	}
	return null;
}

function copyAssets(inputDir, outputDir) {
	for (const entry of readdirSync(inputDir)) {
		if (["assets", "public"].includes(entry)) {
			cpSync(path.join(inputDir, entry), path.join(outputDir, entry), { recursive: true });
		}
	}
}

async function stitchModule(moduleDir, classmapKey) {
	const inputDir = moduleDir.startsWith(MODULES_DIR) || moduleDir.startsWith("modules/")
		? path.join(ROOT, moduleDir)
		: path.join(MODULES_DIR, moduleDir);
	const metadata = readMetadata(inputDir);
	const identifier = `${metadata.name}@${metadata.version}`;
	const outputDir = path.join(DIST_DIR, identifier);
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	console.log(`stitch ${identifier}`);
	await buildJs(inputDir, outputDir, metadata.name);
	buildCss(inputDir, outputDir);
	copyAssets(inputDir, outputDir);

	writeFileSync(path.join(outputDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
	writeFileSync(
		path.join(outputDir, "spicetify-module.json"),
		JSON.stringify(sidecar(metadata, classmapKey), null, 2) + "\n",
	);
	console.log(`  -> ${outputDir}`);
}

async function main() {
	const args = process.argv.slice(2);
	const classmapKey = process.env.CLASSMAP_KEY || "";
	const targets = args.length
		? args
		: readdirSync(MODULES_DIR).filter((d) => statSync(path.join(MODULES_DIR, d)).isDirectory());

	if (!classmapKey) {
		console.warn("warning: CLASSMAP_KEY not set; sidecar classmap_base will be empty (source remap only)");
	}
	for (const target of targets) {
		await stitchModule(target, classmapKey);
	}
}

await main();
