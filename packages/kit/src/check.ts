/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * check - audit a module against the Spicetify Module Standard
 * (docs/module-standard.md). Advisory by design: it reports findings and
 * exits 0, so it guides without blocking. The rules split into a few
 * reliably-checkable structural facts (metadata schema, the entry shim)
 * and heuristic nudges (likely-hardcoded hashed classnames, a second
 * React copy, hand-rolled shared chrome) that flag the common footguns.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { resolveModuleDir } from "./build.ts";

export type Severity = "error" | "warn";
export interface Finding {
	severity: Severity;
	rule: string;
	message: string;
	file?: string;
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
// The shape of a client webpack hash: a separator-free alphanumeric token,
// 8+ chars, mixed case (real module classes are lower-kebab, e.g.
// spicetify-button). Such a token must be a MAP.* reference the CLI
// remaps, not a hardcoded literal that dies on the next client update.
const isHashyClass = (token: string) =>
	token.length >= 8 && /^[A-Za-z0-9]+$/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token);

// checkMetadata validates the metadata.json contract. Structural, so these
// are the one place check emits errors rather than warnings.
export function checkMetadata(meta: unknown): Finding[] {
	const out: Finding[] = [];
	const err = (rule: string, message: string) =>
		out.push({ severity: "error", rule, message, file: "metadata.json" });
	if (typeof meta !== "object" || meta === null) {
		err("metadata.shape", "metadata.json must be a JSON object");
		return out;
	}
	const m = meta as Record<string, unknown>;
	if (typeof m.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(m.name)) {
		err("metadata.name", "name must be a kebab-case string (it is the module identifier)");
	}
	if (typeof m.version !== "string" || !SEMVER.test(m.version)) {
		err("metadata.version", "version must be semver (e.g. 1.0.0)");
	}
	if (typeof m.description !== "string") err("metadata.description", "description must be a string");
	if (!Array.isArray(m.authors)) err("metadata.authors", "authors must be an array");
	if (typeof m.entries !== "object" || m.entries === null) {
		err("metadata.entries", "entries must be an object with js and/or css");
	}
	if (typeof m.dependencies !== "object" || m.dependencies === null) {
		err("metadata.dependencies", "dependencies must be an object (use {} for none)");
	}
	if ("hasMixins" in m && typeof m.hasMixins !== "boolean") {
		err("metadata.hasMixins", "hasMixins must be a boolean when present");
	}
	return out;
}

function readSources(dir: string): Array<{ file: string; text: string }> {
	const out: Array<{ file: string; text: string }> = [];
	const skip = new Set(["node_modules", "dist", "assets", "public"]);
	const walk = (d: string) => {
		for (const entry of readdirSync(d)) {
			const full = path.join(d, entry);
			if (statSync(full).isDirectory()) {
				if (!skip.has(entry)) walk(full);
			} else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") && !/\.test\.[cm]?tsx?$/.test(entry)) {
				out.push({ file: full, text: readFileSync(full, "utf8") });
			}
		}
	};
	walk(dir);
	return out;
}

// checkSource runs the heuristic, per-file rules. Warnings only.
export function checkSource(rel: string, text: string): Finding[] {
	const out: Finding[] = [];
	const lines = text.split("\n");
	lines.forEach((line, i) => {
		const at = `${rel}:${i + 1}`;
		// A second React instance breaks hooks/context identity (one-React
		// rule). expose/React.ts is stdlib's sanctioned single source and is
		// exempt.
		if (
			/from\s+['"]https?:\/\/[^'"]*react[^'"]*['"]/.test(line) &&
			!line.includes("jsx-runtime") &&
			!/expose\/React/.test(rel)
		) {
			out.push({
				severity: "warn",
				rule: "one-react",
				message: "import React from stdlib's expose or the bare 'react' shim, never a second copy",
				file: at,
			});
		}
		// className string that looks like a raw client hash.
		if (/class[nN]ame/.test(line)) {
			for (const q of line.matchAll(/['"]([A-Za-z0-9]+)['"]/g)) {
				if (isHashyClass(q[1])) {
					out.push({
						severity: "warn",
						rule: "map-intact",
						message: `"${q[1]}" looks like a hardcoded client hash; reference it via MAP.* so the CLI remaps it per version`,
						file: at,
					});
				}
			}
		}
		// Hand-rolled SHARED chrome (a kit primitive exists for it) instead
		// of the component kit. Store-specific classes are not flagged.
		if (
			/\b(createElement|el)\(\s*['"](select|input|button|textarea)['"]\s*,\s*['"](spicetify-select|spicetify-searchbar|spicetify-button)\b/.test(
				line,
			)
		) {
			out.push({
				severity: "warn",
				rule: "use-the-kit",
				message: "build shared chrome from the kit (Button/Select/TextInput/...) instead of hand-rolling it",
				file: at,
			});
		}
		// A hand-rolled context-menu row, in any form (className=, a template
		// literal, an el() call). The kit's MenuItem owns Spotify's menu-item
		// class via MENU_ITEM_CLASS, so modules never name it directly; the
		// kit's own source is the one legitimate home for the literal.
		if (/main-contextMenu-menuItemButton/.test(line) && !/primitives/.test(rel)) {
			out.push({
				severity: "warn",
				rule: "use-the-kit",
				message:
					"render context-menu rows with the kit's MenuItem instead of hardcoding main-contextMenu-menuItemButton",
				file: at,
			});
		}
	});
	return out;
}

function checkEntryShim(dir: string, meta: { entries?: { js?: string }; tree?: boolean }): Finding[] {
	// css-only modules (themes) declare no js entry, so there is no loader
	// shim to require; enforcing it would fail every theme build (R4).
	if (!meta.entries?.js) return [];
	const index = path.join(dir, "index.ts");
	if (!existsSync(index)) {
		return [
			{
				severity: "error",
				rule: "entry-shim",
				message: "missing index.ts entry (should defer to ./mod.js so module code loads only once deps are up)",
				file: "index.ts",
			},
		];
	}
	const text = readFileSync(index, "utf8");
	if (!/import\(["']\.\/mod\.js["']\)|export\s+(async\s+)?function\s+(load|preload|mixin)/.test(text)) {
		return [
			{
				severity: "warn",
				rule: "entry-shim",
				message: "index.ts should export load/preload/mixin (typically deferring to ./mod.js)",
				file: "index.ts",
			},
		];
	}
	return [];
}

// checkStructure runs the modularity rules the standard implies but the
// original ports predate: importable exports, a client-free logic core, and
// tests. Warnings only — a ratchet, not a flag day: `create` scaffolds all
// three, so new modules start clean while ports surface their drift.
export function checkStructure(dir: string, meta: { entries?: { js?: string } }): Finding[] {
	// css-only themes have no logic to structure or test.
	if (!meta.entries?.js) return [];
	const out: Finding[] = [];
	const skip = new Set(["node_modules", "dist", "assets", "public"]);

	let hasTests = false;
	const walk = (d: string) => {
		for (const entry of readdirSync(d)) {
			const full = path.join(d, entry);
			if (statSync(full).isDirectory()) {
				if (!skip.has(entry)) walk(full);
			} else if (entry.endsWith(".test.mts")) {
				hasTests = true;
			}
		}
	};
	walk(dir);
	if (!hasTests) {
		out.push({
			severity: "warn",
			rule: "tests",
			message:
				"no *.test.mts anywhere in the module; the standard expects testable logic in a client-free file with colocated node --test coverage",
		});
	}

	const sources = readSources(dir).filter(({ file }) => path.basename(file) !== "index.ts");
	if (!sources.length) return out;

	// Structural rules exist to break up monoliths, not to tax small DOM-glue
	// ports: a 30-line theme toggle has no core worth extracting, and live
	// verification covers it. Below the floor all three rules stay silent.
	const totalLines = sources.reduce((n, { text }) => n + text.split("\n").length, 0);
	if (totalLines < 200) {
		return out.filter((f) => f.rule !== "tests");
	}

	const hasNamedExport = sources.some(({ text }) => /^export (const|let|function|class|async function) /m.test(text));
	if (!hasNamedExport) {
		out.push({
			severity: "warn",
			rule: "exportable-logic",
			message:
				"nothing importable: every declaration sits behind the default export, so no unit can be imported or tested. Hoist logic to top-level named exports",
		});
	}

	const clientRef = /\bSpicetify\.|\bMAP\./;
	const hasPureFile = sources.some(({ text }) => !clientRef.test(text));
	if (!hasPureFile) {
		out.push({
			severity: "warn",
			rule: "pure-core",
			message:
				"no client-free source file: every file references Spicetify or MAP. Move parsers/decisions into a dependency-free file (see store/catalog.ts) so they can run under node --test",
		});
	}
	return out;
}

export function checkModule(dir: string): Finding[] {
	const findings: Finding[] = [];
	const metaPath = path.join(dir, "metadata.json");
	if (!existsSync(metaPath)) {
		return [
			{
				severity: "error",
				rule: "metadata.missing",
				message: "no metadata.json — not a module",
				file: "metadata.json",
			},
		];
	}
	let meta: unknown;
	try {
		meta = JSON.parse(readFileSync(metaPath, "utf8"));
	} catch (e) {
		return [
			{
				severity: "error",
				rule: "metadata.parse",
				message: `metadata.json is not valid JSON: ${(e as Error).message}`,
				file: "metadata.json",
			},
		];
	}
	findings.push(...checkMetadata(meta));
	findings.push(...checkEntryShim(dir, meta as { entries?: { js?: string }; tree?: boolean }));
	findings.push(...checkStructure(dir, meta as { entries?: { js?: string } }));
	for (const { file, text } of readSources(dir)) {
		findings.push(...checkSource(path.relative(dir, file), text));
	}
	return findings;
}

export async function runCheck(argv: string[], cwd = process.cwd()): Promise<void> {
	const target = argv.find((a) => !a.startsWith("--")) ?? ".";
	const modulesDir = path.join(cwd, "modules");
	const dir = resolveModuleDir(target, modulesDir, cwd);
	const findings = checkModule(dir);

	const name = path.basename(dir);
	if (!findings.length) {
		console.log(`✓ ${name}: golden — no standard findings`);
		return;
	}
	const errors = findings.filter((f) => f.severity === "error").length;
	const warns = findings.length - errors;
	for (const f of findings) {
		const tag = f.severity === "error" ? "error" : "warn ";
		console.log(`  ${tag} [${f.rule}] ${f.file ?? ""}  ${f.message}`);
	}
	console.log(`\n${name}: ${errors} error(s), ${warns} warning(s) against the module standard (advisory).`);
}
