#!/usr/bin/env node
/**
 * check-deps - release tripwire for workspace dependency ranges.
 *
 * For every module depending on another workspace module, the declared range
 * must be satisfied by the dependency's current version or by a version its
 * compat list vouches for. This is what failed silently when stdlib went
 * 1.0.0 while every dependent still declared ^0.3.0: the loader (correctly)
 * refused all of them at boot. Fails the batch at publish time instead.
 *
 * usage: node scripts/check-deps.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

interface Meta {
	name: string;
	version: string;
	compat?: string[];
	dependencies?: Record<string, string> | string[];
}

// The comparator subset module metadata actually uses (mirrors the loader's
// semver-lite): *, exact, ^, ~, and >=/<=/>/< comparators.
function satisfies(version: string, range: string): boolean {
	const parse = (v: string) => {
		const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
		if (!m) throw new Error(`unparsable version: ${v}`);
		return { major: +m[1], minor: +m[2], patch: +m[3] };
	};
	const cmp = (a: ReturnType<typeof parse>, b: ReturnType<typeof parse>) =>
		a.major - b.major || a.minor - b.minor || a.patch - b.patch;
	const v = parse(version);
	const trimmed = range.trim();
	if (trimmed === "" || trimmed === "*" || trimmed.toLowerCase() === "x") return true;
	return trimmed.split(/\s+/).every((part) => {
		const m = part.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+\.\d+\.\d+)/);
		if (!m) throw new Error(`unsupported range: ${part}`);
		const [, op = "", base] = m;
		const c = parse(base);
		switch (op) {
			case "^": {
				const upper =
					c.major > 0
						? { major: c.major + 1, minor: 0, patch: 0 }
						: c.minor > 0
							? { major: 0, minor: c.minor + 1, patch: 0 }
							: { major: 0, minor: 0, patch: c.patch + 1 };
				return cmp(v, c) >= 0 && cmp(v, upper) < 0;
			}
			case "~":
				return cmp(v, c) >= 0 && v.major === c.major && v.minor === c.minor;
			case ">=":
				return cmp(v, c) >= 0;
			case "<=":
				return cmp(v, c) <= 0;
			case ">":
				return cmp(v, c) > 0;
			case "<":
				return cmp(v, c) < 0;
			default:
				return cmp(v, c) === 0;
		}
	});
}

const metas = new Map<string, Meta>();
for (const rootName of ["modules", "themes", "snippets"]) {
	const root = path.join(process.cwd(), rootName);
	if (!existsSync(root)) continue;
	for (const entry of readdirSync(root)) {
		const metaPath = path.join(root, entry, "metadata.json");
		try {
			if (!statSync(path.join(root, entry)).isDirectory()) continue;
			metas.set(entry, JSON.parse(readFileSync(metaPath, "utf8")));
		} catch {
			/* not a module dir */
		}
	}
}

let failures = 0;
for (const [id, meta] of metas) {
	const deps = meta.dependencies;
	if (!deps || Array.isArray(deps)) continue;
	for (const [dep, range] of Object.entries(deps)) {
		const depMeta = metas.get(dep);
		// Dependencies outside the workspace are the loader's problem at
		// install time; the gate covers what this repo publishes together.
		if (!depMeta) continue;
		const vouched = [depMeta.version, ...(depMeta.compat ?? [])];
		if (!vouched.some((v) => satisfies(v, range))) {
			console.error(
				`✖ ${id} needs ${dep}@${range}, but ${dep} is ${depMeta.version}` +
					(depMeta.compat?.length ? ` (compat: ${depMeta.compat.join(", ")})` : " (no compat list)") +
					` — bump the range or add a compat entry to ${dep}`,
			);
			failures++;
		}
	}
}

if (failures) {
	console.error(`\ncheck-deps: ${failures} unsatisfied workspace range(s); this WILL black out dependents at boot`);
	process.exit(1);
}
console.log(`check-deps: ${metas.size} modules, all workspace ranges satisfied`);
