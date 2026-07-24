/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * from-theme - migrate a classic spicetify theme (user.css + color.ini)
 * into a v3 theme module.
 *
 * Theme modules are CSS-only modules: user.css becomes the css entry,
 * color.ini ships alongside it and the loader applies the preferred
 * scheme at load ([Section] names become switchable schemes). Previews
 * are copied into assets/.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const USAGE = 'spicetify-kit from-theme <classic-theme-dir> [--name <id>] [--author "..."] [--bare]';

export async function runFromTheme(argv: string[], cwd = process.cwd()): Promise<void> {
	const source = argv.find((a) => !a.startsWith("--"));
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const bare = argv.includes("--bare");
	if (!source) throw new Error(USAGE);

	const themeDir = path.resolve(cwd, source);
	const userCss = path.join(themeDir, "user.css");
	const colorIni = path.join(themeDir, "color.ini");
	if (!existsSync(userCss) && !existsSync(colorIni)) {
		throw new Error(`${themeDir} has neither user.css nor color.ini; not a classic theme`);
	}

	const name = flag("name") ?? path.basename(themeDir).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
	if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`derived name "${name}" is not kebab-case; pass --name`);
	const author = flag("author") ?? "spicetify";

	const dir = bare ? path.join(cwd, "modules", name) : path.join(cwd, name);
	if (existsSync(dir)) throw new Error(`${dir} already exists`);
	mkdirSync(dir, { recursive: true });

	const hasCss = existsSync(userCss);
	if (hasCss) cpSync(userCss, path.join(dir, "index.css"));
	if (existsSync(colorIni)) cpSync(colorIni, path.join(dir, "color.ini"));

	const previews = readdirSync(themeDir).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f)).sort();
	if (previews.length) {
		mkdirSync(path.join(dir, "assets"), { recursive: true });
		for (const p of previews) cpSync(path.join(themeDir, p), path.join(dir, "assets", p));
	}

	writeFileSync(
		path.join(dir, "metadata.json"),
		`${
			JSON.stringify(
				{
					name,
					tags: ["theme"],
					version: "0.1.0",
					authors: [author],
					description: `${path.basename(themeDir)} theme, migrated from the classic format`,
					...(previews.length ? { preview: `./assets/${previews[0]}` } : {}),
					entries: hasCss ? { css: "index.css" } : {},
					hasMixins: false,
					dependencies: {},
				},
				null,
				"\t",
			)
		}\n`,
	);

	if (!bare) {
		writeFileSync(
			path.join(dir, "package.json"),
			`${
				JSON.stringify(
					{
						name,
						private: true,
						type: "module",
						scripts: {
							build: "spicetify-kit build .",
							dev: "spicetify-kit dev .",
						},
						devDependencies: {
							"@spicetify/kit": "^0.1.0",
						},
					},
					null,
					"\t",
				)
			}\n`,
		);
		writeFileSync(path.join(dir, ".gitignore"), "node_modules/\ndist/\n");
	}

	const rel = path.relative(cwd, dir) || ".";
	console.log(`created ${rel}/ from ${path.basename(themeDir)}`);
	console.log("notes:");
	console.log("  - classic user.css targets classic class names; selectors may need updating for current clients");
	if (existsSync(colorIni)) {
		console.log("  - color.ini sections become switchable schemes (Spicetify.Modules.schemes/setScheme)");
	}
	if (!bare) {
		console.log("next steps:");
		console.log(`  cd ${rel} && npm install`);
		console.log("  npm run dev        # hot-push into a running client");
	}
}
