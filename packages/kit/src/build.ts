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
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import path from "node:path";

import { checkModule } from "./check.ts";
import { generateClassmapDts, loadConfig, resolveClassmap, type ClassmapResolution } from "./classmap.ts";
import type { StdlibBoundaryExceptionRule } from "./stdlib-boundary.ts";

export type ModuleKind = "extension" | "theme" | "snippet" | "app" | "lib";

export interface ModuleMetadata {
	name: string;
	kind?: ModuleKind;
	version: string;
	authors: string[];
	description: string;
	entries: { js?: string; css?: string };
	hasMixins: boolean;
	dependencies: Record<string, string>;
	stdlibBoundary?: {
		exceptions: Array<{
			file: string;
			rules: StdlibBoundaryExceptionRule[];
			reason: string;
		}>;
	};
	tree?: boolean;
}

const EXTERNALS = [/^https?:\/\//];

// Runtime URLs the react family resolves to (see the resolveId plugin).
// react-dom/server has no client instance to share, so it stays on esm.sh;
// nothing imports it at boot.
const REACT_RUNTIME_URLS: Record<string, string> = {
	react: "/modules/stdlib/src/expose/react-shim.js",
	"react/jsx-runtime": "/modules/stdlib/src/expose/jsx-runtime.js",
	"react-dom": "/modules/stdlib/src/expose/react-dom-shim.js",
	"react-dom/client": "/modules/stdlib/src/expose/react-dom-shim.js",
	"react-dom/server": "https://esm.sh/react-dom@18.3.1/server",
};

const USAGE = `spicetify-kit build [module...] [--classmap <key|path>] [--out <dir>]

  module...        module folders to build; a folder containing
                   metadata.json is a module, otherwise it is resolved
                   inside --modules (default: all modules in ./modules,
                   or the current directory when it is itself a module)
  --classmap, -c   classmap key (e.g. 1020094; fetched from the published
                   spicetify/classmaps repo and cached when not present
                   locally) or a direct path to a classmap json
  --out, -o        output dir (default: ./dist)
  --modules, -m    modules dir (default: ./modules)
  --no-check       skip the module-standard check (error-tier findings
                   otherwise abort the build)
  --watch          rebuild a single module on change (no hot-push)
  --refresh        force a classmap refetch, bypassing vendored/cache`;

export function readMetadata(dir: string): ModuleMetadata {
	return JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf8"));
}

// A watch event should trigger a rebuild unless it is the generated
// classmap.d.ts (reacting to it loops) or a dotfile.
export function shouldRebuildOnChange(file: string | null): boolean {
	return !!file && !file.endsWith(".d.ts") && !file.startsWith(".");
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
				// Emit "react/jsx-runtime" so the plugin below externalizes it
				// to the stdlib-local runtime.
				importSource: "react",
			},
		},
		// One React rule, enforced at resolution: npm-style react specifiers
		// become external runtime URLs into stdlib's client-instance shims,
		// never bundled copies. This must be a resolveId plugin, not a
		// resolve.alias entry — externals are tested on the raw specifier, so
		// an aliased runtime URL is followed on to the local source file and
		// inlined into every module (which is how the jsx runtime briefly
		// dragged stdlib's React capture into each built .tsx module).
		plugins: [
			{
				name: "react-runtime-urls",
				resolveId: (source: string) =>
					REACT_RUNTIME_URLS[source] ? { id: REACT_RUNTIME_URLS[source], external: true as const } : null,
			},
		],
		resolve: {
			extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
			alias: {
				"/modules": [path.join(cwd, "modules")],
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

	// Staged modules serve .js; sources import "/modules/*.ts" URLs.
	const rewriteRuntimeTs = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const full = path.join(dir, entry);
			if (statSync(full).isDirectory()) {
				rewriteRuntimeTs(full);
			} else if (entry.endsWith(".js")) {
				const content = readFileSync(full, "utf8");
				const rewritten = content.replace(/"(\/modules\/[^"]+)\.tsx?"/g, '"$1.js"');
				if (rewritten !== content) writeFileSync(full, rewritten);
			}
		}
	};
	rewriteRuntimeTs(outputDir);
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
	opts: { check?: "enforce" | "warn" | "off" } = {},
): Promise<string> {
	const metadata = readMetadata(inputDir);
	const identifier = `${metadata.name}@${metadata.version}`;

	// The standard's error tier is enforced at build (KTD4): error-tier
	// findings abort before any dist output, warnings print and continue.
	// "warn" (the dev loop) never blocks; "off" is --no-check.
	const check = opts.check ?? "enforce";
	if (check !== "off") {
		const findings = checkModule(inputDir);
		for (const f of findings) {
			const tag = f.severity === "error" ? "error" : "warn ";
			console.error(`  ${tag} [${f.rule}] ${f.file ?? ""}  ${f.message}`);
		}
		const errors = findings.filter((f) => f.severity === "error");
		if (check === "enforce" && errors.length) {
			throw new Error(
				`${metadata.name}: ${errors.length} error-tier finding(s) against the module standard; ` +
					"fix them, or build with --no-check.",
			);
		}
	}
	const outputDir = path.join(outDir, identifier);
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	console.log(`stitch ${identifier}`);
	// Theme modules are css-only: no js entry means nothing to bundle.
	if (metadata.entries.js) await buildJs(inputDir, outputDir, metadata.tree ?? false, cwd);
	buildCss(inputDir, outputDir);
	copyAssets(inputDir, outputDir);
	// The loader applies color schemes from a color.ini shipped with the
	// module (sections become switchable schemes).
	if (existsSync(path.join(inputDir, "color.ini"))) {
		cpSync(path.join(inputDir, "color.ini"), path.join(outputDir, "color.ini"));
	}

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
	noCheck: boolean;
	refresh: boolean;
	watch: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
	const out: ParsedArgs = {
		targets: [],
		classmap: null,
		outDir: null,
		modulesDir: null,
		noCheck: false,
		refresh: false,
		watch: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		switch (a) {
			case "--no-check":
				out.noCheck = true;
				break;
			case "--refresh":
				out.refresh = true;
				break;
			case "--watch":
				out.watch = true;
				break;
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

// Sibling content roots next to the modules dir: the org repo splits
// content by kind (modules/, themes/, snippets/) purely for repo
// navigation; the runtime namespace stays /modules/<id> regardless.
export function contentRoots(modulesDir: string): string[] {
	const siblings = ["themes", "snippets"].map((name) => path.join(path.dirname(modulesDir), name));
	return [modulesDir, ...siblings.filter((dir) => existsSync(dir))];
}

// resolveModuleDir accepts a module folder directly (metadata.json
// present) or a name inside any content root.
export function resolveModuleDir(target: string, modulesDir: string, cwd: string): string {
	const direct = path.resolve(cwd, target);
	if (existsSync(path.join(direct, "metadata.json"))) return direct;
	for (const root of contentRoots(modulesDir)) {
		const nested = path.join(root, target);
		if (existsSync(path.join(nested, "metadata.json"))) return nested;
	}
	throw new Error(`no metadata.json under ${direct} or ${contentRoots(modulesDir).join(", ")}`);
}

export async function runBuild(argv: string[], cwd = process.cwd()): Promise<void> {
	const args = parseArgs(argv);
	const config = loadConfig(cwd);
	const resolved = await resolveClassmap({ flag: args.classmap, config, cwd, refresh: args.refresh });
	if (!resolved.path) throw new Error("no classmap found (pass --classmap <key|path>)");
	console.log(`classmap: ${resolved.path}${resolved.key ? ` (key ${resolved.key})` : ""}`);

	const modulesDir =
		args.modulesDir ?? (config.modulesDir ? path.resolve(cwd, config.modulesDir) : path.join(cwd, "modules"));
	const outDir = args.outDir ?? (config.outDir ? path.resolve(cwd, config.outDir) : path.join(cwd, "dist"));

	let targets = args.targets;
	if (!targets.length) {
		if (existsSync(path.join(cwd, "metadata.json"))) {
			targets = ["."];
		} else if (existsSync(modulesDir)) {
			// Batch build spans every content root; targets are paths, so
			// a same-named dir in two roots resolves unambiguously.
			targets = contentRoots(modulesDir).flatMap((root) =>
				readdirSync(root)
					.filter((d) => statSync(path.join(root, d)).isDirectory())
					.map((d) => path.join(root, d)),
			);
		} else {
			throw new Error(`nothing to build: no metadata.json in ${cwd} and no ${modulesDir}`);
		}
	}

	// --watch rebuilds a single module on change (no hot-push), for authors who
	// cannot use the CDP dev loop. It never blocks: a failed build logs and the
	// watcher keeps running.
	if (args.watch) {
		const moduleDir = resolveModuleDir(targets[0], modulesDir, cwd);
		const rebuild = async () => {
			try {
				await buildModule(moduleDir, outDir, resolved, cwd, { check: args.noCheck ? "off" : "warn" });
			} catch (e) {
				console.error(`[build] ${(e as Error).message}`);
			}
		};
		await rebuild();
		console.log(`[build] watching ${moduleDir} (ctrl-c to stop)`);
		let timer: NodeJS.Timeout | undefined;
		let loggedDts = false;
		watch(moduleDir, { recursive: true }, (_e, file) => {
			if (!file) return;
			// The build regenerates classmap.d.ts into the source dir; reacting
			// to it would loop. Note the skip once so it is not a mystery.
			if (file.endsWith(".d.ts")) {
				if (!loggedDts) {
					console.log("[build] ignoring generated classmap.d.ts changes");
					loggedDts = true;
				}
				return;
			}
			if (file.startsWith(".")) return;
			clearTimeout(timer);
			timer = setTimeout(() => void rebuild(), 200);
		});
		await new Promise(() => {});
		return;
	}

	for (const target of targets) {
		await buildModule(resolveModuleDir(target, modulesDir, cwd), outDir, resolved, cwd, {
			check: args.noCheck ? "off" : "enforce",
		});
	}
}
