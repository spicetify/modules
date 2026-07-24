/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * build - bundle v3 modules for the spicetify modular runtime.
 *
 * Bundles each module with rolldown (TS/TSX), compiles SCSS entries, and
 * writes <out>/<name>@<version>/ with metadata.json and the
 * spicetify-module.json sidecar. Modules ship MAP-intact: class
 * references are remapped at apply/install time against the exact
 * installed classmap, so one build serves every supported Spotify
 * version.
 */

import { rolldown } from "rolldown";
import * as sass from "sass-embedded";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateClassmapDts, loadConfig, resolveClassmap, type ClassmapResolution } from "./classmap.ts";

export interface ModuleMetadata {
	name: string;
	tags: string[];
	version: string;
	authors: string[];
	description: string;
	entries: { js?: string; css?: string };
	hasMixins: boolean;
	dependencies: Record<string, string>;
	tree?: boolean;
}

const EXTERNALS = [/^\/hooks\//, /^https?:\/\//];

const USAGE = `spicetify-kit build [module...] [--classmap <key|path>] [--out <dir>]

  module...        module folders to build; a folder containing
                   metadata.json is a module, otherwise it is resolved
                   inside --modules (default: all modules in ./modules,
                   or the current directory when it is itself a module)
  --classmap, -c   classmap key (e.g. 1020094; fetched from the published
                   spicetify/classmaps repo and cached when not present
                   locally) or a direct path to a classmap json
  --out, -o        output dir (default: ./dist)
  --modules, -m    modules dir (default: ./modules)`;

export function readMetadata(dir: string): ModuleMetadata {
	return JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf8"));
}

async function buildJs(inputDir: string, outputDir: string, tree: boolean, cwd: string): Promise<void> {
	// Multi-entry: mod.ts (when present) is the module's public barrel and
	// gets a stable facade at the dist root so OTHER modules can import it
	// at runtime (e.g. /modules/stdlib/mod.js).
	const input: Record<string, string> = { index: path.join(inputDir, "index.ts") };
	const barrel = path.join(inputDir, "mod.ts");
	if (existsSync(barrel)) input.mod = barrel;

	// Tree modules are runtime libraries: every source file becomes an
	// entry so dependent modules can deep-import any path, not just what
	// the module's own graph happens to reach.
	if (tree) {
		const SKIP_DIRS = new Set(["node_modules", "assets", "public"]);
		const SKIP_FILES = new Set(["CODEGEN.ts"]);
		const addTreeEntries = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				const full = path.join(dir, entry);
				if (statSync(full).isDirectory()) {
					if (!SKIP_DIRS.has(entry)) addTreeEntries(full);
				} else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") && !SKIP_FILES.has(entry)) {
					const name = path.relative(inputDir, full).replace(/\.tsx?$/, "");
					input[name] ??= full;
				}
			}
		};
		addTreeEntries(inputDir);
	}

	const bundle = await rolldown({
		input,
		external: [...EXTERNALS, /^\/modules\//],
		transform: {
			jsx: {
				importSource: "https://esm.sh/react@18.3.1",
			},
		},
		resolve: {
			extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
			alias: {
				"/modules": [path.join(cwd, "modules")],
				// One React rule: npm-style react imports resolve to stdlib's
				// client-instance shims (runtime URLs, always external), so
				// module hooks share the client dispatcher. The jsx runtime
				// stays on esm.sh — element creation is instance-independent.
				"react/jsx-runtime": ["https://esm.sh/react@18.3.1/jsx-runtime"],
				"react": ["/modules/stdlib/src/expose/react-shim.js"],
				"react-dom/client": ["/modules/stdlib/src/expose/react-dom-shim.js"],
				"react-dom/server": ["https://esm.sh/react-dom@18.3.1/server"],
				"react-dom": ["/modules/stdlib/src/expose/react-dom-shim.js"],
			},
		},
	});
	await bundle.write({
		dir: outputDir,
		format: "esm",
		sourcemap: true,
		preserveModules: tree,
		// Leaf modules ship as one chunk: local installs run entries through
		// blob URLs, where relative chunk imports cannot resolve.
		...(!tree && Object.keys(input).length === 1 ? { codeSplitting: false } : {}),
	});

	// The hooks compat pack serves .js; Deno-era sources import "/hooks/*.ts".
	const rewriteHooksTs = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = path.join(dir, entry);
			if (statSync(full).isDirectory()) {
				rewriteHooksTs(full);
			} else if (entry.endsWith(".js")) {
				const content = readFileSync(full, "utf8");
				const rewritten = content
					.replace(/"(\/hooks\/[^"]+)\.tsx?"/g, '"$1.js"')
					.replace(/"(\/modules\/[^"]+)\.tsx?"/g, '"$1.js"');
				if (rewritten !== content) writeFileSync(full, rewritten);
			}
		}
	};
	rewriteHooksTs(outputDir);
}

function buildCss(inputDir: string, outputDir: string): void {
	const scss = path.join(inputDir, "index.scss");
	const css = path.join(inputDir, "index.css");
	if (existsSync(scss)) {
		const result = sass.compile(scss, { style: "compressed" });
		writeFileSync(path.join(outputDir, "index.css"), result.css);
	} else if (existsSync(css)) {
		cpSync(css, path.join(outputDir, "index.css"));
	}
}

function copyAssets(inputDir: string, outputDir: string): void {
	for (const entry of readdirSync(inputDir)) {
		if (["assets", "public"].includes(entry)) {
			cpSync(path.join(inputDir, entry), path.join(outputDir, entry), { recursive: true });
		}
	}
}

// buildModule builds a single module dir into outDir and returns the dist
// path. The classmap resolution is passed in so multi-module runs and the
// dev loop resolve it once.
export async function buildModule(
	inputDir: string,
	outDir: string,
	resolved: ClassmapResolution,
	cwd: string,
): Promise<string> {
	const metadata = readMetadata(inputDir);
	const identifier = `${metadata.name}@${metadata.version}`;
	const outputDir = path.join(outDir, identifier);
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	console.log(`stitch ${identifier}`);
	await buildJs(inputDir, outputDir, metadata.tree ?? false, cwd);
	buildCss(inputDir, outputDir);
	copyAssets(inputDir, outputDir);

	const classmap = JSON.parse(readFileSync(resolved.path!, "utf8"));
	writeFileSync(path.join(inputDir, "classmap.d.ts"), generateClassmapDts(classmap));

	writeFileSync(path.join(outputDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
	writeFileSync(
		path.join(outputDir, "spicetify-module.json"),
		JSON.stringify(
			{ installed_version: metadata.version, classmap_base: resolved.key, allow_stale: false },
			null,
			2,
		) + "\n",
	);
	console.log(`  -> ${outputDir}`);
	return outputDir;
}

interface ParsedArgs {
	targets: string[];
	classmap: string | null;
	outDir: string | null;
	modulesDir: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: ParsedArgs = { targets: [], classmap: null, outDir: null, modulesDir: null };
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

// resolveModuleDir accepts a module folder directly (metadata.json
// present) or a name inside the modules dir.
export function resolveModuleDir(target: string, modulesDir: string, cwd: string): string {
	const direct = path.resolve(cwd, target);
	if (existsSync(path.join(direct, "metadata.json"))) return direct;
	const nested = path.join(modulesDir, target);
	if (existsSync(path.join(nested, "metadata.json"))) return nested;
	throw new Error(`no metadata.json under ${direct} or ${nested}`);
}

export async function runBuild(argv: string[], cwd = process.cwd()): Promise<void> {
	const args = parseArgs(argv);
	const config = loadConfig(cwd);
	const resolved = await resolveClassmap({ flag: args.classmap, config, cwd });
	if (!resolved.path) throw new Error("no classmap found (pass --classmap <key|path>)");
	console.log(`classmap: ${resolved.path}${resolved.key ? ` (key ${resolved.key})` : ""}`);

	const modulesDir = args.modulesDir ?? (config.modulesDir ? path.resolve(cwd, config.modulesDir) : path.join(cwd, "modules"));
	const outDir = args.outDir ?? (config.outDir ? path.resolve(cwd, config.outDir) : path.join(cwd, "dist"));

	let targets = args.targets;
	if (!targets.length) {
		if (existsSync(path.join(cwd, "metadata.json"))) {
			targets = ["."];
		} else if (existsSync(modulesDir)) {
			targets = readdirSync(modulesDir).filter((d) => statSync(path.join(modulesDir, d)).isDirectory());
		} else {
			throw new Error(`nothing to build: no metadata.json in ${cwd} and no ${modulesDir}`);
		}
	}

	for (const target of targets) {
		await buildModule(resolveModuleDir(target, modulesDir, cwd), outDir, resolved, cwd);
	}
}
