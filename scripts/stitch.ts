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

interface ModuleMetadata {
	name: string;
	tags: string[];
	version: string;
	authors: string[];
	description: string;
	entries: { js?: string; css?: string };
	hasMixins: boolean;
	dependencies: Record<string, string>;
}

interface ModuleSidecar {
	installed_version: string;
	classmap_base: string;
	allow_stale: boolean;
}

interface StitchConfig {
	classmap?: string;
	classmapsDir?: string;
	modulesDir?: string;
	outDir?: string;
}

interface ClassmapResolution {
	path: string | null;
	key: string;
}

interface ParsedArgs {
	targets: string[];
	classmap: string | null;
	outDir: string;
	modulesDir: string;
}

const ROOT = process.cwd();
const MODULES_DIR = path.join(ROOT, "modules");
const DIST_DIR = path.join(ROOT, "dist");

const EXTERNALS = [/^\/hooks\//, /^https?:\/\//];

const USAGE = `stitch - build v3 modules

usage: node scripts/stitch.ts [module...] [--classmap <key|path>] [--out <dir>]

  module...        module folders to build (default: all in ./modules)
  --classmap, -c   classmap key (e.g. 1020094, resolved against the classmaps
                   repo) or a direct path to a classmap json
  --out, -o        output dir (default: ./dist)
  --modules, -m    modules dir (default: ./modules)

resolution order for the classmap:
  1. --classmap flag
  2. stitch.config.json ("classmap" / "classmapsDir")
  3. newest key folder in the classmaps repo (../classmaps by default)
  4. ./classmap.json (back-compat)`

function readMetadata(dir: string): ModuleMetadata {
	return JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf8"));
}

function sidecar(metadata: ModuleMetadata, classmapKey: string): ModuleSidecar {
	return {
		installed_version: metadata.version,
		classmap_base: classmapKey,
		allow_stale: false,
	};
}

// generateClassmapDts emits a global MAP declaration so module sources get
// typed classmap paths without importing anything.
function generateClassmapDts(classmap: Record<string, unknown>): string {
	const render = (node: Record<string, unknown>, indent: number): string => {
		const pad = "\t".repeat(indent);
		const lines = ["{"];
		for (const key of Object.keys(node).sort()) {
			const value = node[key];
			if (typeof value === "string") {
				lines.push(`${pad}\t${JSON.stringify(key)}: string;`);
			} else {
				lines.push(`${pad}\t${JSON.stringify(key)}: ${render(value, indent + 1)};`);
			}
		}
		lines.push(`${pad}}`);
		return lines.join("\n");
	};
	return `declare global {\n\tconst MAP: ${render(classmap, 1)};\n}\n\nexport {};\n`;
}

function loadConfig(): StitchConfig {
	const configPath = path.join(ROOT, "stitch.config.json");
	if (!existsSync(configPath)) return {};
	try {
		return JSON.parse(readFileSync(configPath, "utf8"));
	} catch {
		return {};
	}
}

function latestClassmapFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir).filter((f) => /^classmap(-.*)?\.json$/.test(f)).sort();
	return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function classmapKeyFromPath(filePath: string): string {
	return path.basename(path.dirname(filePath));
}

function classmapsDirs(config: StitchConfig): string[] {
	const dirs = [];
	if (config.classmapsDir) dirs.push(config.classmapsDir);
	dirs.push(path.join(ROOT, "..", "classmaps"), path.join(ROOT, "classmaps"));
	return dirs;
}

function resolveClassmap({ flag, config }: { flag: string | null; config: StitchConfig }): ClassmapResolution {
	const candidates = [];
	if (flag) candidates.push(flag);
	if (config.classmap) candidates.push(config.classmap);
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return { path: candidate, key: classmapKeyFromPath(candidate) };
		}
		for (const dir of classmapsDirs(config)) {
			const file = latestClassmapFile(path.join(dir, candidate));
			if (file) return { path: file, key: candidate };
		}
	}
	// auto: newest key folder in any classmaps checkout
	for (const dir of classmapsDirs(config)) {
		if (!existsSync(dir)) continue;
		const keys = readdirSync(dir)
			.filter((d) => /^\d{7}$/.test(d))
			.sort();
		for (let i = keys.length - 1; i >= 0; i--) {
			const file = latestClassmapFile(path.join(dir, keys[i]));
			if (file) return { path: file, key: keys[i] };
		}
	}
	// back-compat
	if (existsSync(path.join(ROOT, "classmap.json"))) {
		return { path: path.join(ROOT, "classmap.json"), key: "" };
	}
	return { path: null, key: "" };
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: ParsedArgs = { targets: [], classmap: null, outDir: DIST_DIR, modulesDir: MODULES_DIR };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		switch (a) {
			case "--classmap":
			case "-c":
				out.classmap = next();
				break;
			case "--out":
			case "-o":
				out.outDir = path.resolve(next());
				break;
			case "--modules":
			case "-m":
				out.modulesDir = path.resolve(next());
				break;
			case "--help":
			case "-h":
				console.log(USAGE);
				process.exit(0);
			default:
				if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
				out.targets.push(a);
		}
	}
	return out;
}

async function buildJs(inputDir: string, outputDir: string, identifier: string): Promise<void> {
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

function buildCss(inputDir: string, outputDir: string): string | null {
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

function copyAssets(inputDir: string, outputDir: string): void {
	for (const entry of readdirSync(inputDir)) {
		if (["assets", "public"].includes(entry)) {
			cpSync(path.join(inputDir, entry), path.join(outputDir, entry), { recursive: true });
		}
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const config = loadConfig();
	const resolved = resolveClassmap({ flag: args.classmap, config });

	const modulesDir = config.modulesDir ? path.resolve(config.modulesDir) : args.modulesDir;
	const outDir = config.outDir ? path.resolve(config.outDir) : args.outDir;

	if (!resolved.path) {
		console.error("no classmap found (pass --classmap <key|path>, set stitch.config.json, or clone spicetify/classmaps next to this repo)");
		process.exit(1);
	}
	console.log(`classmap: ${resolved.path}${resolved.key ? ` (key ${resolved.key})` : ""}`);

	const targets = args.targets.length
		? args.targets
		: readdirSync(modulesDir).filter((d) => statSync(path.join(modulesDir, d)).isDirectory());

	for (const target of targets) {
		const inputDir = target.startsWith(modulesDir) || target.startsWith("modules/")
			? path.join(ROOT, target)
			: path.join(modulesDir, target);
		const metadata = readMetadata(inputDir);
		const identifier = `${metadata.name}@${metadata.version}`;
		const outputDir = path.join(outDir, identifier);
		rmSync(outputDir, { recursive: true, force: true });
		mkdirSync(outputDir, { recursive: true });

		console.log(`stitch ${identifier}`);
		await buildJs(inputDir, outputDir, metadata.name);
		buildCss(inputDir, outputDir);
		copyAssets(inputDir, outputDir);

		const classmap = JSON.parse(readFileSync(resolved.path, "utf8"));
		writeFileSync(path.join(inputDir, "classmap.d.ts"), generateClassmapDts(classmap));

		writeFileSync(path.join(outputDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
		writeFileSync(
			path.join(outputDir, "spicetify-module.json"),
			JSON.stringify(sidecar(metadata, resolved.key), null, 2) + "\n",
		);
		console.log(`  -> ${outputDir}`);
	}
}

await main();
