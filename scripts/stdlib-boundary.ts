#!/usr/bin/env node
/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { inspectStdlibBoundaryFile, type StdlibBoundarySourceRule } from "../packages/kit/src/stdlib-boundary.ts";

export type BoundaryRule = StdlibBoundarySourceRule | "missing-stdlib-dependency";

export interface BoundaryViolation {
	module: string;
	file: string;
	rule: BoundaryRule | "stale-exception";
	detail: string;
}

export interface BoundaryPolicy {
	schemaVersion: 1;
	categoryExceptions?: Array<{
		root: string;
		rules: BoundaryRule[];
		reason: string;
	}>;
	exceptions?: Array<{
		module: string;
		file: string;
		rules: BoundaryRule[];
		reason: string;
	}>;
}

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss"]);

const posix = (value: string) => value.split(path.sep).join("/");

function walk(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		if (["assets", "dist", "node_modules", "public"].includes(entry)) continue;
		const full = path.join(root, entry);
		if (statSync(full).isDirectory()) files.push(...walk(full));
		else if (!/\.test\.[cm]?[jt]sx?$/.test(entry)) files.push(full);
	}
	return files;
}

function rawViolations(root: string): BoundaryViolation[] {
	const out: BoundaryViolation[] = [];
	for (const rootName of ["modules", "themes"]) {
		const collection = path.join(root, rootName);
		if (!existsSync(collection)) continue;
		for (const dirName of readdirSync(collection)) {
			const dir = path.join(collection, dirName);
			const metaPath = path.join(dir, "metadata.json");
			if (!existsSync(metaPath) || !statSync(dir).isDirectory()) continue;
			const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
				name?: string;
				entries?: { js?: string };
				dependencies?: Record<string, string> | string[];
			};
			const id = meta.name ?? dirName;
			if (id === "stdlib") continue;
			const dependencies = Array.isArray(meta.dependencies) ? {} : (meta.dependencies ?? {});
			if (meta.entries?.js && typeof dependencies.stdlib !== "string") {
				out.push({
					module: id,
					file: posix(path.relative(root, metaPath)),
					rule: "missing-stdlib-dependency",
					detail: "has executable code but does not declare a direct stdlib dependency",
				});
			}
			for (const absolute of walk(dir)) {
				const ext = path.extname(absolute);
				if (!SOURCE_EXTENSIONS.has(ext) && !STYLE_EXTENSIONS.has(ext)) continue;
				const file = path.relative(root, absolute);
				const text = readFileSync(absolute, "utf8");
				out.push(
					...inspectStdlibBoundaryFile(file, text).map((finding) => ({
						module: id,
						file: finding.file,
						rule: finding.rule,
						detail: finding.detail,
					})),
				);
			}
		}
	}
	return out;
}

export function auditStdlibBoundary(root: string, policy: BoundaryPolicy): BoundaryViolation[] {
	if (policy.schemaVersion !== 1) throw new Error(`unsupported stdlib boundary policy: ${policy.schemaVersion}`);
	const raw = rawViolations(root);
	const exact = policy.exceptions ?? [];
	const categories = policy.categoryExceptions ?? [];
	for (const item of [...exact, ...categories]) {
		if (!item.reason.trim()) throw new Error("every stdlib boundary exception needs a reason");
	}
	const allowed = (finding: BoundaryViolation) => {
		if (
			categories.some(
				(exception) =>
					finding.file.startsWith(`${exception.root.replace(/\/$/, "")}/`) &&
					exception.rules.includes(finding.rule as BoundaryRule),
			)
		) {
			return true;
		}
		return exact.some(
			(exception) =>
				exception.module === finding.module &&
				exception.file === finding.file &&
				exception.rules.includes(finding.rule as BoundaryRule),
		);
	};
	const unresolved = raw.filter((finding) => !allowed(finding));
	for (const exception of exact) {
		for (const rule of exception.rules) {
			if (
				!raw.some(
					(finding) =>
						finding.module === exception.module && finding.file === exception.file && finding.rule === rule,
				)
			) {
				unresolved.push({
					module: exception.module,
					file: exception.file,
					rule: "stale-exception",
					detail: `${rule} is no longer present; remove this exception`,
				});
			}
		}
	}
	return unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

export function loadBoundaryPolicy(root: string): BoundaryPolicy {
	return JSON.parse(readFileSync(path.join(root, "stdlib-boundary-exceptions.json"), "utf8"));
}

async function main() {
	const root = process.cwd();
	const policy = loadBoundaryPolicy(root);
	const findings = auditStdlibBoundary(root, policy);
	if (!findings.length) {
		console.log(
			`stdlib-boundary: clean (${policy.exceptions?.length ?? 0} file exceptions; ${policy.categoryExceptions?.length ?? 0} category exception)`,
		);
		return;
	}
	for (const finding of findings) {
		console.error(`✖ [${finding.rule}] ${finding.file}: ${finding.detail}`);
	}
	console.error(`\nstdlib-boundary: ${findings.length} unapproved boundary violation(s)`);
	process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
