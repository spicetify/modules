#!/usr/bin/env node
/**
 * create-module - scaffold a new module under modules/<name>.
 *
 * usage:
 *   node scripts/create-module.ts <name> [--description "..."] [--author "..."]
 *
 * Generates the metadata, the loader entry shim, a hello-world mod.tsx
 * showing the registrar (topbar button + route page), and the SCSS entry.
 * Build with stitch, or iterate live with scripts/dev.ts.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const flag = (n: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? args[i + 1] : undefined;
};

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
	console.error('usage: node scripts/create-module.ts <name> [--description "..."] [--author "..."]');
	console.error("name must be kebab-case (it doubles as the module identifier)");
	process.exit(1);
}

const dir = path.join(process.cwd(), "modules", name);
if (existsSync(dir)) {
	console.error(`${dir} already exists`);
	process.exit(1);
}

const description = flag("description") ?? `${name} module`;
const author = flag("author") ?? "spicetify";
const year = new Date().getFullYear();
const header = `/*\n * Copyright (C) ${year} ${author}\n * SPDX-License-Identifier: GPL-3.0-or-later\n */\n`;

mkdirSync(dir, { recursive: true });

writeFileSync(
	path.join(dir, "metadata.json"),
	`${JSON.stringify(
		{
			name,
			tags: ["extension"],
			version: "0.1.0",
			authors: [author],
			description,
			entries: { js: "index.js", css: "index.css" },
			hasMixins: false,
			dependencies: { stdlib: "^0.3.0" },
		},
		null,
		"\t",
	)}\n`,
);

// The loader imports index.js and calls load(); the shim defers the real
// entry so module code only evaluates once dependencies are up.
writeFileSync(
	path.join(dir, "index.ts"),
	`${header}
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";

export async function load(ctx: ModuleRuntimeContext) {
	return (await import("./mod.js")).default(ctx);
}
`,
);

writeFileSync(
	path.join(dir, "mod.tsx"),
	`${header}
import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { Platform } from "/modules/stdlib/src/expose/Platform.ts";
import { TopbarRightButton } from "/modules/stdlib/src/registers/topbarRightButton.tsx";

const ROUTE = "/bespoke/${name}";

// 16-grid icon (a plain circle); replace with your own inner SVG markup.
const ICON = '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>';

const Page = () => (
	<div className="${name}-page">
		<h1>${name}</h1>
		<p>Hello from ${name}. Edit modules/${name}/mod.tsx and run scripts/dev.ts to iterate live.</p>
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
`,
);

writeFileSync(
	path.join(dir, "index.scss"),
	`.${name}-page {
	padding: 24px 32px;
	color: var(--spice-text);
}
`,
);

console.log(`created modules/${name}/`);
console.log("next steps:");
console.log(`  node scripts/stitch.ts modules/${name}     # one-off build into dist/`);
console.log(`  node scripts/dev.ts modules/${name}        # watch + hot-push into a running client`);
