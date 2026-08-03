#!/usr/bin/env node
/**
 * sync-vendor - copy the stdlib TypeScript sources into
 * vendor/ so published kits carry the type surface module authors
 * compile against. Runs from the monorepo at pack time; vendored copies
 * are generated artifacts, never edited.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(KIT));
const WORKSPACE = path.dirname(REPO);
const VENDOR = path.join(KIT, "vendor");

const SKIP_DIRS = new Set(["node_modules", ".git", "assets", "public"]);
const SKIP_FILES = new Set(["classmap.d.ts", "CODEGEN.ts"]);

function copyTsTree(from: string, to: string): number {
	let count = 0;
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from)) {
		const src = path.join(from, entry);
		if (statSync(src).isDirectory()) {
			if (!SKIP_DIRS.has(entry)) count += copyTsTree(src, path.join(to, entry));
		} else if (/\.(ts|tsx)$/.test(entry) && !SKIP_FILES.has(entry)) {
			cpSync(src, path.join(to, entry));
			count++;
		}
	}
	return count;
}

rmSync(VENDOR, { recursive: true, force: true });

const stdlib = copyTsTree(path.join(REPO, "modules", "stdlib"), path.join(VENDOR, "stdlib"));
// The scaffold derives a fresh module's stdlib range from this version.
cpSync(path.join(REPO, "modules", "stdlib", "metadata.json"), path.join(VENDOR, "stdlib", "metadata.json"));

const shims = path.join(VENDOR, "shims");
mkdirSync(shims, { recursive: true });
cpSync(path.join(REPO, "remote-modules.d.ts"), path.join(shims, "remote-modules.d.ts"));
cpSync(path.join(REPO, "modules", "stdlib", "src", "chunks.d.ts"), path.join(shims, "chunks.d.ts"));
// Ambient Spicetify global types, so scaffolded modules are typed by default.
cpSync(path.join(REPO, "spicetify.d.ts"), path.join(shims, "spicetify.d.ts"));

// Vendor the newest verified classmap so a standalone author's first build
// resolves one offline (U5). Copy only the classmap json under <key>/.
let vendoredClassmap = "none";
const classmapsSrc = path.join(WORKSPACE, "classmaps");
if (existsSync(classmapsSrc)) {
	const keys = readdirSync(classmapsSrc)
		.filter((d) => /^\d{7}$/.test(d) && statSync(path.join(classmapsSrc, d)).isDirectory())
		.sort();
	const key = keys[keys.length - 1];
	if (key) {
		const keyDir = path.join(classmapsSrc, key);
		const maps = readdirSync(keyDir)
			.filter((f) => /^classmap(-.*)?\.json$/.test(f))
			.sort();
		const map = maps[maps.length - 1];
		if (map) {
			const dest = path.join(VENDOR, "classmaps", key);
			mkdirSync(dest, { recursive: true });
			cpSync(path.join(keyDir, map), path.join(dest, map));
			vendoredClassmap = `${key}/${map}`;
		}
	}
}

console.log(`vendored ${stdlib} stdlib files, 3 shims, classmap ${vendoredClassmap} -> ${VENDOR}`);
