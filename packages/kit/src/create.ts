/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * create - scaffold a new spicetify v3 module.
 *
 * Standalone (default): creates ./<name>/ as a self-contained project
 * with metadata, sources, tsconfig wired to the kit's vendored stdlib
 * types, and a package.json ready for `spicetify-kit build/dev`.
 *
 * --bare: emits only the module sources into modules/<name>/, for use
 * inside the spicetify modules monorepo.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The stdlib range a fresh module declares tracks the stdlib it will compile
// against: the vendored copy in a published kit, the workspace copy in the
// monorepo. A hardcoded literal here went stale once (^0.3.0 outlived the
// 1.0.0 bump) and only the loader's compat vouch saved the scaffolds.
function stdlibRange(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const candidates = [
		path.join(here, "..", "vendor", "stdlib", "metadata.json"),
		path.join(here, "..", "..", "..", "modules", "stdlib", "metadata.json"),
	];
	for (const p of candidates) {
		try {
			const version = JSON.parse(readFileSync(p, "utf8")).version;
			if (typeof version === "string" && version) return `^${version}`;
		} catch {
			/* try the next source */
		}
	}
	return "^1.0.0";
}

const USAGE =
	'spicetify-kit create <name> [--template basic|extension|app|theme] [--description "..."] [--author "..."] [--bare]';

const HELP = `${USAGE}

templates:
  basic        a topbar button plus a route page (default)
  extension    behavior-only (a songchange listener) with a testable logic.ts
  app          a navlink plus a full route page built from the primitives
  theme        a css-only theme (color.ini + index.css; no TypeScript tooling)`;

type Template = "basic" | "extension" | "app" | "theme";

const ICON_LITERAL = `'<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>'`;

// modTemplate returns the mod.tsx for a template. Every template follows the
// standard: it registers through createRegistrar (which auto-disposes),
// imports React only from stdlib, and self-subscribes/disposes its own
// listeners.
function modTemplate(template: Template, name: string, header: string): string {
	const route = `/bespoke/${name}`;
	if (template === "extension") {
		return `${header}
import { client, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { nowPlaying } from "./logic.ts";

// Extensions add behavior (and optionally small UI via a register). The
// golden rules: subscribe to client state yourself, and undo everything on
// unload via ctx.defer — a module that lingers after a reload is a bug.
// The typed client capability surface keeps the ambient wrapper behind one
// stdlib boundary. Testable logic lives in ./logic.ts and receives plain data.

export default async function (ctx: ModuleRuntimeContext) {
	const onSongChange = () => {
		// Runs on every track change. Replace with your behavior.
		console.log("[${name}]", nowPlaying(client.player.data?.item));
	};
	client.player.addEventListener("songchange", onSongChange);
	ctx.defer(() => client.player.removeEventListener("songchange", onSongChange));
}
`;
	}
	if (template === "app") {
		return `${header}
import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { NavLink } from "/modules/stdlib/src/registers/navlink.tsx";
import { Button } from "/modules/stdlib/lib/primitives.js";
import { nowPlaying } from "./logic.ts";

const ROUTE = "${route}";
const ICON = ${ICON_LITERAL};

const Page = () => (
	<div className="${name}-page">
		<h1>${name}</h1>
		<p>A full page at ${route}. Build it from the React primitives (lib/primitives).</p>
		<p>Now playing: {nowPlaying(client.player.data?.item)}</p>
		<Button variant="secondary" onClick={() => {}}>A kit button</Button>
	</div>
);

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register("navlink", <NavLink localizedApp="${name}" appRoutePath={ROUTE} icon={ICON} activeIcon={ICON} />);
	registrar.registerRoute(ROUTE, <Page />);
}
`;
	}
	return `${header}
import { client, createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { Platform } from "/modules/stdlib/src/expose/Platform.ts";
import { TopbarRightButton } from "/modules/stdlib/src/registers/topbarRightButton.tsx";
import { nowPlaying } from "./logic.ts";

const ROUTE = "${route}";
const ICON = ${ICON_LITERAL};

const Page = () => (
	<div className="${name}-page">
		<h1>${name}</h1>
		<p>Hello from ${name}. Edit mod.tsx and run the dev command to iterate live.</p>
		<p>Now playing: {nowPlaying(client.player.data?.item)}</p>
	</div>
);

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);

	registrar.register(
		"topbarRightButton",
		<TopbarRightButton label="${name}" icon={ICON} onClick={() => Platform.getHistory().push(ROUTE)} />,
	);
	registrar.registerRoute(ROUTE, <Page />);
}
`;
}

// Pure, client-free logic — unit-testable. mod.tsx passes plain capability
// values into these functions, so a test exercises them without a client.
function logicTemplate(header: string): string {
	return `${header}
/**
 * Pure, client-free module logic. Keep functions here dependency-free (no
 * /modules/* or client imports) so they are unit-testable; mod.tsx passes
 * plain values into them. Starter tests import this file,
 * never mod.tsx.
 */

export function nowPlaying(item: { name?: string } | undefined): string {
	return item?.name ?? "nothing playing";
}
`;
}

// The happy-dom harness the standard's test loop needs, written locally so a
// scaffolded project owns it and needs no cross-package resolution.
function setupTemplate(header: string): string {
	return `${header}
// DOM test harness: installs happy-dom's document/window and the common
// element/event constructors onto globalThis so DOM-building logic can be
// unit-tested under \`node --test\` with no browser. Import this FIRST in any
// *.test.mts that touches the DOM.

import { Window } from "happy-dom";

const win = new Window({ url: "https://xpui.app.spotify.com" });

for (
	const key of [
		"document",
		"window",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLButtonElement",
		"HTMLInputElement",
		"HTMLDivElement",
		"HTMLSpanElement",
		"Event",
		"CustomEvent",
		"MouseEvent",
		"KeyboardEvent",
	] as const
) {
	(globalThis as Record<string, unknown>)[key] = key === "window"
		? win
		: (win as unknown as Record<string, unknown>)[key];
}
`;
}

// setupImport is the test's harness import; logicImport is derived from where
// the test file sits relative to logic.ts (co-located for bare, one up for the
// non-bare test/ dir).
function testTemplate(header: string, setupImport: string, logicImport: string): string {
	return `${header}
import "${setupImport}";

import assert from "node:assert/strict";
import { test } from "node:test";

import { nowPlaying } from "${logicImport}";

test("nowPlaying returns the track name, or a fallback when idle", () => {
	assert.equal(nowPlaying({ name: "A Song" }), "A Song");
	assert.equal(nowPlaying(undefined), "nothing playing");
});
`;
}

// Themes are css-only modules (KTD6): no js entry, no TypeScript tooling. The
// loader applies a scheme from color.ini ([Section] names are switchable
// schemes), and index.css restyles the client through the --spice-* variables.
function writeThemeModule(
	dir: string,
	name: string,
	description: string,
	author: string,
	bare: boolean,
	cwd: string,
): void {
	writeFileSync(
		path.join(dir, "metadata.json"),
		`${JSON.stringify(
			{
				name,
				tags: ["theme"],
				version: "0.1.0",
				authors: [author],
				description,
				entries: { css: "index.css" },
				hasMixins: false,
				dependencies: {},
			},
			null,
			"\t",
		)}\n`,
	);

	// Two example schemes; each [Section] becomes a switchable scheme. Keys are
	// hex (no #); the loader exposes them as --spice-<key>.
	writeFileSync(
		path.join(dir, "color.ini"),
		`[Base]
text               = FFFFFF
subtext            = A7A7A7
main               = 121212
sidebar            = 000000
player             = 181818
card               = 242424
button             = 1ED760
button-active      = 1FDF64
button-disabled    = 3E3E3E
selected-row       = 1ED760
notification       = 303030

[Midnight]
text               = E6E6FA
subtext            = 9A9AC0
main               = 0A0A14
sidebar            = 05050B
player             = 10101C
card               = 16162A
button             = 7B68EE
button-active      = 9385F0
button-disabled    = 2A2A3A
selected-row       = 7B68EE
notification       = 1C1C30
`,
	);

	writeFileSync(
		path.join(dir, "index.css"),
		`/*
 * ${name} — a spicetify theme.
 *
 * color.ini defines the palette; the loader exposes each key as a --spice-*
 * CSS variable and applies your chosen [Section] as the active scheme. Add
 * rules here that consume those variables to restyle the client.
 */

.main-view-container__scroll-node {
	background-color: var(--spice-main);
}

.main-nowPlayingBar-nowPlayingBar {
	background-color: var(--spice-player);
}
`,
	);

	if (!bare) {
		writeFileSync(
			path.join(dir, "package.json"),
			`${JSON.stringify(
				{
					name,
					private: true,
					type: "module",
					// css-only: no tsc, no TypeScript or React devDeps.
					scripts: {
						build: "spicetify-kit build .",
						dev: "spicetify-kit dev .",
						check: "spicetify-kit check .",
					},
					devDependencies: { "@spicetify/kit": "^0.1.0" },
				},
				null,
				"\t",
			)}\n`,
		);
		writeFileSync(path.join(dir, ".gitignore"), "node_modules/\ndist/\n");
	}

	const rel = path.relative(cwd, dir) || ".";
	console.log(`created ${rel}/ (theme)`);
	console.log("notes:");
	console.log("  - edit color.ini schemes and index.css; each [Section] is a switchable scheme");
	console.log("  - add preview images under assets/ and set metadata.preview to the first one");
	if (!bare) {
		console.log("next steps:");
		console.log(`  cd ${rel} && npm install`);
		console.log("  npm run dev        # hot-push into a running client");
	}
}

export async function runCreate(argv: string[], cwd = process.cwd()): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(HELP);
		return;
	}
	const name = argv.find((a) => !a.startsWith("--"));
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const bare = argv.includes("--bare");
	const template = (flag("template") ?? "basic") as Template;
	if (!["basic", "extension", "app", "theme"].includes(template)) {
		throw new Error(`${USAGE}\ntemplate must be basic, extension, app, or theme`);
	}

	if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
		throw new Error(`${USAGE}\nname must be kebab-case (it doubles as the module identifier)`);
	}

	const dir = bare ? path.join(cwd, "modules", name) : path.join(cwd, name);
	if (existsSync(dir)) throw new Error(`${dir} already exists`);

	const description = flag("description") ?? `${name} module`;
	const author = flag("author") ?? "spicetify";
	const year = new Date().getFullYear();
	const header = `/*\n * Copyright (C) ${year} ${author}\n * SPDX-License-Identifier: GPL-3.0-or-later\n */\n`;

	mkdirSync(dir, { recursive: true });

	if (template === "theme") {
		writeThemeModule(dir, name, description, author, bare, cwd);
		return;
	}

	const tag = template === "app" ? "app" : "extension";
	// Extensions are behavior-only; templates that render a page ship css.
	const hasCss = template !== "extension";
	const entries = hasCss ? { js: "index.js", css: "index.css" } : { js: "index.js" };

	writeFileSync(
		path.join(dir, "metadata.json"),
		`${JSON.stringify(
			{
				name,
				tags: [tag],
				version: "0.1.0",
				authors: [author],
				description,
				entries,
				hasMixins: false,
				dependencies: { stdlib: stdlibRange() },
			},
			null,
			"\t",
		)}\n`,
	);

	// The loader imports index.js and calls load(); the shim defers the
	// real entry so module code only evaluates once dependencies are up.
	writeFileSync(
		path.join(dir, "index.ts"),
		`${header}
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

export async function load(ctx: ModuleRuntimeContext) {
	return (await import("./mod.js")).default(ctx);
}
`,
	);

	writeFileSync(path.join(dir, "mod.tsx"), modTemplate(template, name, header));

	// Testable seam: pure logic lives in logic.ts, with a starter test that
	// imports it (never mod.tsx — JSX and /modules/* URLs do not run in Node).
	writeFileSync(path.join(dir, "logic.ts"), logicTemplate(header));
	if (bare) {
		// Monorepo: a co-located test the root test glob picks up, using
		// stdlib's shared harness.
		writeFileSync(
			path.join(dir, `${name}.test.mts`),
			testTemplate(header, "../stdlib/lib/test-setup.mts", "./logic.ts"),
		);
	} else {
		mkdirSync(path.join(dir, "test"), { recursive: true });
		writeFileSync(path.join(dir, "test", "setup.mts"), setupTemplate(header));
		writeFileSync(path.join(dir, "test", `${name}.test.mts`), testTemplate(header, "./setup.mts", "../logic.ts"));
	}

	if (hasCss) {
		writeFileSync(
			path.join(dir, "index.scss"),
			`.${name}-page {
	padding: 24px 32px;
	color: var(--spice-text);
}
`,
		);
	}

	if (!bare) {
		writeFileSync(
			path.join(dir, "package.json"),
			`${JSON.stringify(
				{
					name,
					private: true,
					type: "module",
					// node --test with a test/-scoped glob; escaped double quotes
					// (single quotes break cmd.exe, bare ** can match node_modules).
					engines: { node: ">=22.6" },
					scripts: {
						build: "spicetify-kit build .",
						dev: "spicetify-kit dev .",
						check: "tsc && spicetify-kit check .",
						test: 'node --test "test/*.test.mts"',
					},
					devDependencies: {
						"@spicetify/kit": "^0.1.0",
						"@types/react": "^18",
						"@types/react-dom": "^18",
						"happy-dom": "^20",
						rxjs: "^7.8.1",
						typescript: "^7",
					},
				},
				null,
				"\t",
			)}\n`,
		);

		// Editor/typecheck config: runtime URLs map to the kit's vendored
		// stdlib sources.
		writeFileSync(
			path.join(dir, "tsconfig.json"),
			`${JSON.stringify(
				{
					compilerOptions: {
						target: "ES2022",
						module: "ESNext",
						moduleResolution: "Bundler",
						allowImportingTsExtensions: true,
						noEmit: true,
						jsx: "react-jsx",
						lib: ["ES2024", "ESNext.Disposable", "DOM", "DOM.Iterable"],
						strict: false,
						skipLibCheck: true,
						resolveJsonModule: true,
						types: [],
						paths: {
							"/modules/*": ["./node_modules/@spicetify/kit/vendor/*"],
						},
					},
					include: ["**/*"],
					files: [
						"./node_modules/@spicetify/kit/vendor/shims/remote-modules.d.ts",
						"./node_modules/@spicetify/kit/vendor/shims/chunks.d.ts",
						"./node_modules/@spicetify/kit/vendor/shims/spicetify.d.ts",
					],
					exclude: ["node_modules", "dist"],
				},
				null,
				"\t",
			)}\n`,
		);

		// Placeholder MAP declaration; the first build replaces it with the
		// typed shape generated from the resolved classmap.
		writeFileSync(
			path.join(dir, "classmap.d.ts"),
			"// Regenerated with real classmap paths on every build.\ndeclare global {\n\tconst MAP: any;\n}\n\nexport {};\n",
		);

		writeFileSync(path.join(dir, ".gitignore"), "node_modules/\ndist/\n");
	}

	const rel = path.relative(cwd, dir) || ".";
	console.log(`created ${rel}/`);
	console.log("next steps:");
	if (bare) {
		console.log(`  node scripts/stitch.ts modules/${name}     # one-off build into dist/`);
		console.log(`  node scripts/dev.ts modules/${name}        # watch + hot-push into a running client`);
	} else {
		console.log(`  cd ${rel} && npm install`);
		console.log(
			"  npm run dev        # watch + hot-push into a running client (Spotify started with --remote-debugging-port=9229)",
		);
		console.log("  npm run build      # one-off build into dist/");
	}
}
