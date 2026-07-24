#!/usr/bin/env node
/**
 * sync-vendor - copy the stdlib and hooks TypeScript sources into
 * vendor/ so published kits carry the type surface module authors
 * compile against. Runs from the monorepo at pack time; vendored copies
 * are generated artifacts, never edited.
 */

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
		} else if (entry.endsWith(".js") && from.endsWith("polyfills")) {
			// hooks/module.ts imports its polyfills by .js name.
			cpSync(src, path.join(to, entry));
			count++;
		}
	}
	return count;
}

rmSync(VENDOR, { recursive: true, force: true });

const stdlib = copyTsTree(path.join(REPO, "modules", "stdlib"), path.join(VENDOR, "stdlib"));
const hooks = copyTsTree(path.join(WORKSPACE, "hooks"), path.join(VENDOR, "hooks"));

const shims = path.join(VENDOR, "shims");
mkdirSync(shims, { recursive: true });
cpSync(path.join(REPO, "remote-modules.d.ts"), path.join(shims, "remote-modules.d.ts"));
cpSync(path.join(REPO, "hooks-std-text.d.ts"), path.join(shims, "hooks-std-text.d.ts"));
cpSync(path.join(REPO, "modules", "stdlib", "src", "chunks.d.ts"), path.join(shims, "chunks.d.ts"));

console.log(`vendored ${stdlib} stdlib files, ${hooks} hooks files, 3 shims -> ${VENDOR}`);
