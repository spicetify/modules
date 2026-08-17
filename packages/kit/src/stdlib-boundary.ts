/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const STDLIB_BOUNDARY_WARNING_RULES = ["ambient-client", "client-dom", "direct-map"] as const;
export type StdlibBoundaryWarningRule = (typeof STDLIB_BOUNDARY_WARNING_RULES)[number];
export type StdlibBoundarySourceRule = StdlibBoundaryWarningRule | "private-stdlib-import";
export type StdlibBoundaryExceptionRule = StdlibBoundaryWarningRule | "missing-stdlib-dependency";

export interface StdlibBoundarySourceFinding {
	file: string;
	line: number;
	rule: StdlibBoundarySourceRule;
	detail: string;
}

export interface ExternalBoundaryFinding {
	severity: "error" | "warn";
	rule: string;
	message: string;
	file?: string;
}

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const STYLE_EXTENSIONS = new Set([".css", ".scss"]);
const PUBLIC_STDLIB_IMPORT =
	/^\/modules\/stdlib\/(?:mod\.(?:js|ts)|lib\/primitives(?:-classes|-vanilla)?\.(?:js|ts|tsx))$/;
const CLIENT_DOM_PATTERN =
	/(?:^|[^A-Za-z0-9_-])(?:Root__|main-[A-Za-z]|player-controls__|playback-progressbar|npv-)|\[data-testid(?:=|\])/;

const posix = (value: string) => value.split(path.sep).join("/");
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

// Preserve string contents and character offsets while removing comments, so
// imports/selectors still match and diagnostics retain their original line.
function withoutComments(text: string): string {
	let out = "";
	let state: "code" | "single" | "double" | "template" | "line" | "block" = "code";
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const next = text[i + 1];
		if (state === "line") {
			if (char === "\n") {
				state = "code";
				out += char;
			} else out += " ";
			continue;
		}
		if (state === "block") {
			if (char === "*" && next === "/") {
				out += "  ";
				i++;
				state = "code";
			} else out += char === "\n" ? "\n" : " ";
			continue;
		}
		if (state === "code") {
			if (char === "/" && next === "/") {
				out += "  ";
				i++;
				state = "line";
				continue;
			}
			if (char === "/" && next === "*") {
				out += "  ";
				i++;
				state = "block";
				continue;
			}
			if (char === "'") state = "single";
			else if (char === '"') state = "double";
			else if (char === "`") state = "template";
			out += char;
			continue;
		}
		out += char;
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (
			(state === "single" && char === "'") ||
			(state === "double" && char === '"') ||
			(state === "template" && char === "`")
		) {
			state = "code";
		}
	}
	return out;
}

function firstMatch(source: string, pattern: RegExp): RegExpExecArray | null {
	pattern.lastIndex = 0;
	return pattern.exec(source);
}

export function inspectStdlibBoundaryFile(file: string, text: string): StdlibBoundarySourceFinding[] {
	const extension = path.extname(file);
	if (!SOURCE_EXTENSIONS.has(extension) && !STYLE_EXTENSIONS.has(extension)) return [];
	const normalizedFile = posix(file);
	const source = withoutComments(text);
	const findings: StdlibBoundarySourceFinding[] = [];

	if (SOURCE_EXTENSIONS.has(extension)) {
		const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\/modules\/stdlib\/[^"']+)["']/g;
		for (const match of source.matchAll(imports)) {
			if (PUBLIC_STDLIB_IMPORT.test(match[1])) continue;
			findings.push({
				file: normalizedFile,
				line: lineAt(source, match.index),
				rule: "private-stdlib-import",
				detail: `${match[1]} is private; import through /modules/stdlib/mod.js or the primitives kit`,
			});
		}
		const ambient = firstMatch(source, /\bSpicetify\s*(?:\?\.|\.)|\b(?:globalThis|window)\s*\.\s*Spicetify\b/);
		if (ambient) {
			findings.push({
				file: normalizedFile,
				line: lineAt(source, ambient.index),
				rule: "ambient-client",
				detail: "imports should use stdlib's typed client capability instead of ambient Spicetify.*",
			});
		}
		const directMap = firstMatch(source, /\bMAP\s*\./);
		if (directMap) {
			findings.push({
				file: normalizedFile,
				line: lineAt(source, directMap.index),
				rule: "direct-map",
				detail: "MAP.* is direct client coupling; prefer a semantic stdlib surface",
			});
		}
	}

	const clientDom = firstMatch(source, CLIENT_DOM_PATTERN);
	if (clientDom) {
		findings.push({
			file: normalizedFile,
			line: lineAt(source, clientDom.index),
			rule: "client-dom",
			detail: "Spotify-owned DOM selectors should be isolated and documented",
		});
	}
	return findings;
}

interface BoundaryException {
	file: string;
	rules: StdlibBoundaryExceptionRule[];
	reason: string;
}

function parseExceptions(meta: Record<string, unknown>): {
	exceptions: BoundaryException[];
	findings: ExternalBoundaryFinding[];
} {
	const configured = meta.stdlibBoundary;
	if (configured === undefined) return { exceptions: [], findings: [] };
	const invalid = (message: string): ExternalBoundaryFinding => ({
		severity: "error",
		rule: "metadata.stdlib-boundary",
		message,
		file: "metadata.json",
	});
	if (typeof configured !== "object" || configured === null || Array.isArray(configured)) {
		return { exceptions: [], findings: [invalid("stdlibBoundary must be an object")] };
	}
	const values = (configured as { exceptions?: unknown }).exceptions;
	if (!Array.isArray(values)) {
		return { exceptions: [], findings: [invalid("stdlibBoundary.exceptions must be an array")] };
	}
	const exceptions: BoundaryException[] = [];
	const findings: ExternalBoundaryFinding[] = [];
	const allowedRules = new Set<StdlibBoundaryExceptionRule>([
		...STDLIB_BOUNDARY_WARNING_RULES,
		"missing-stdlib-dependency",
	]);
	for (const [index, value] of values.entries()) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			findings.push(invalid(`stdlibBoundary.exceptions[${index}] must be an object`));
			continue;
		}
		const candidate = value as { file?: unknown; rules?: unknown; reason?: unknown };
		const validFile =
			typeof candidate.file === "string" &&
			candidate.file.length > 0 &&
			!candidate.file.includes("\\") &&
			!path.posix.isAbsolute(candidate.file) &&
			path.posix.normalize(candidate.file) === candidate.file &&
			!candidate.file.startsWith("../");
		const validRules =
			Array.isArray(candidate.rules) &&
			candidate.rules.length > 0 &&
			candidate.rules.every(
				(rule) => typeof rule === "string" && allowedRules.has(rule as StdlibBoundaryExceptionRule),
			);
		if (!validFile || !validRules || typeof candidate.reason !== "string" || !candidate.reason.trim()) {
			findings.push(
				invalid(
					`stdlibBoundary.exceptions[${index}] needs a normalized relative file, supported rules, and a reason`,
				),
			);
			continue;
		}
		exceptions.push(candidate as BoundaryException);
	}
	return { exceptions, findings };
}

function boundaryFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory)) {
			if (["assets", "dist", "node_modules", "public"].includes(entry)) continue;
			const full = path.join(directory, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (!/\.test\.[cm]?[jt]sx?$/.test(entry)) files.push(full);
		}
	};
	walk(root);
	return files;
}

export function checkExternalStdlibBoundary(root: string, metadata: unknown): ExternalBoundaryFinding[] {
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return [];
	const meta = metadata as Record<string, unknown>;
	const parsed = parseExceptions(meta);
	const out = [...parsed.findings];
	const entries = meta.entries as { js?: unknown } | undefined;
	if (typeof entries?.js !== "string" || meta.name === "stdlib") return out;
	const isTheme = meta.kind === "theme" || (Array.isArray(meta.tags) && meta.tags.some((tag) => tag === "theme"));

	const dependencies = meta.dependencies;
	const missingDependency =
		!isTheme &&
		typeof dependencies === "object" &&
		dependencies !== null &&
		!Array.isArray(dependencies) &&
		typeof (dependencies as Record<string, unknown>).stdlib !== "string";
	const sources = boundaryFiles(root).flatMap((absolute) => {
		const file = posix(path.relative(root, absolute));
		return inspectStdlibBoundaryFile(file, readFileSync(absolute, "utf8"));
	});
	const exceptionAllows = (file: string, rule: StdlibBoundaryExceptionRule) =>
		parsed.exceptions.some((item) => item.file === file && item.rules.includes(rule));

	if (missingDependency && !exceptionAllows("metadata.json", "missing-stdlib-dependency")) {
		out.push({
			severity: "error",
			rule: "stdlib-boundary.dependency",
			message: "executable modules must declare a direct stdlib dependency",
			file: "metadata.json",
		});
	}
	for (const finding of sources) {
		if (finding.rule === "private-stdlib-import") {
			out.push({
				severity: "error",
				rule: "stdlib-boundary.private-import",
				message: finding.detail,
				file: `${finding.file}:${finding.line}`,
			});
		} else if (!isTheme && !exceptionAllows(finding.file, finding.rule)) {
			out.push({
				severity: "warn",
				rule: `stdlib-boundary.${finding.rule}`,
				message: `${finding.detail}; document an exception only when the coupling is intrinsic`,
				file: `${finding.file}:${finding.line}`,
			});
		}
	}

	for (const exception of parsed.exceptions) {
		for (const rule of exception.rules) {
			const present =
				rule === "missing-stdlib-dependency"
					? exception.file === "metadata.json" && missingDependency
					: sources.some((finding) => finding.file === exception.file && finding.rule === rule);
			if (!present) {
				out.push({
					severity: "error",
					rule: "stdlib-boundary.stale-exception",
					message: `${exception.file} no longer has ${rule}; remove the exception`,
					file: "metadata.json",
				});
			}
		}
	}
	return out;
}
