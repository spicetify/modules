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

import { pathToFileURL } from "node:url";

import { auditModuleImports, buildModuleGraph } from "./module-graph.ts";

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

export function checkDependencies(root: string): { modules: number; findings: string[] } {
	const graph = buildModuleGraph(root);
	const findings = auditModuleImports(graph).map(
		(finding) => `[${finding.rule}] ${finding.file}:${finding.line}: ${finding.detail}`,
	);
	for (const [id, meta] of graph.modules) {
		for (const [dependency, range] of meta.ranges) {
			const target = graph.modules.get(dependency);
			if (!target) continue;
			const vouched = [target.version, ...target.compat];
			if (!vouched.some((version) => satisfies(version, range))) {
				findings.push(
					`${id} needs ${dependency}@${range}, but ${dependency} is ${target.version}` +
						(target.compat.length ? ` (compat: ${target.compat.join(", ")})` : " (no compat list)") +
						` — bump the range or add a compat entry to ${dependency}`,
				);
			}
		}
	}
	return { modules: graph.modules.size, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const result = checkDependencies(process.cwd());
		if (result.findings.length) {
			for (const finding of result.findings) console.error(`✖ ${finding}`);
			console.error(`\ncheck-deps: ${result.findings.length} dependency or module-boundary violation(s)`);
			process.exitCode = 1;
		} else console.log(`check-deps: ${result.modules} modules, all workspace ranges and imports satisfied`);
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
