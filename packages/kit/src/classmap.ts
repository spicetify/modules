/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface ClassmapResolution {
	path: string | null;
	key: string;
}

export interface KitConfig {
	classmap?: string;
	classmapsDir?: string;
	modulesDir?: string;
	outDir?: string;
}

const CLASSMAPS_REPO = "spicetify/classmaps";

function cacheDir(): string {
	const base = process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache");
	return path.join(base, "spicetify-kit", "classmaps");
}

function latestClassmapFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir).filter((f) => /^classmap(-.*)?\.json$/.test(f)).sort();
	return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function classmapKeyFromPath(filePath: string): string {
	return path.basename(path.dirname(filePath));
}

function localClassmapsDirs(cwd: string, config: KitConfig): string[] {
	const dirs: string[] = [];
	if (config.classmapsDir) dirs.push(path.resolve(cwd, config.classmapsDir));
	dirs.push(path.join(cwd, "..", "classmaps"), path.join(cwd, "classmaps"));
	return dirs;
}

async function githubJson(url: string): Promise<any> {
	const res = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
	return res.json();
}

// fetchRemoteClassmap downloads a classmap (by key, or the newest key when
// none is given) from the published classmaps repo, caching it so later
// builds work offline.
async function fetchRemoteClassmap(key: string | null): Promise<ClassmapResolution> {
	const cache = cacheDir();
	try {
		let resolvedKey = key;
		if (!resolvedKey) {
			const entries = await githubJson(`https://api.github.com/repos/${CLASSMAPS_REPO}/contents/`);
			const keys = entries
				.filter((e: any) => e.type === "dir" && /^\d{7}$/.test(e.name))
				.map((e: any) => e.name)
				.sort();
			if (!keys.length) throw new Error("no classmap keys in remote repo");
			resolvedKey = keys[keys.length - 1];
		}
		const cachedDir = path.join(cache, resolvedKey!);
		const cached = latestClassmapFile(cachedDir);
		if (cached) return { path: cached, key: resolvedKey! };

		const files = await githubJson(`https://api.github.com/repos/${CLASSMAPS_REPO}/contents/${resolvedKey}`);
		const names = files
			.filter((f: any) => f.type === "file" && /^classmap(-.*)?\.json$/.test(f.name))
			.map((f: any) => f.name)
			.sort();
		if (!names.length) throw new Error(`no classmap json under key ${resolvedKey}`);
		const name = names[names.length - 1];
		const raw = await fetch(`https://raw.githubusercontent.com/${CLASSMAPS_REPO}/main/${resolvedKey}/${name}`);
		if (!raw.ok) throw new Error(`classmap download -> HTTP ${raw.status}`);
		const body = await raw.text();
		JSON.parse(body);
		mkdirSync(cachedDir, { recursive: true });
		const target = path.join(cachedDir, name);
		writeFileSync(target, body);
		return { path: target, key: resolvedKey! };
	} catch (e) {
		// Offline fallback: newest cached key, if any exists.
		if (existsSync(cache)) {
			const keys = readdirSync(cache).filter((d) => /^\d{7}$/.test(d)).sort();
			for (let i = keys.length - 1; i >= 0; i--) {
				if (key && keys[i] !== key) continue;
				const file = latestClassmapFile(path.join(cache, keys[i]));
				if (file) return { path: file, key: keys[i] };
			}
		}
		throw new Error(`cannot fetch classmap from ${CLASSMAPS_REPO}: ${(e as Error).message}`);
	}
}

export async function resolveClassmap(
	{ flag, config, cwd }: { flag: string | null; config: KitConfig; cwd: string },
): Promise<ClassmapResolution> {
	const candidates: string[] = [];
	if (flag) candidates.push(flag);
	if (config.classmap) candidates.push(config.classmap);
	for (const candidate of candidates) {
		const asPath = path.resolve(cwd, candidate);
		if (existsSync(asPath) && !/^\d{7}$/.test(candidate)) {
			return { path: asPath, key: classmapKeyFromPath(asPath) };
		}
		for (const dir of localClassmapsDirs(cwd, config)) {
			const file = latestClassmapFile(path.join(dir, candidate));
			if (file) return { path: file, key: candidate };
		}
		if (/^\d{7}$/.test(candidate)) return fetchRemoteClassmap(candidate);
	}
	// Monorepo mode: newest key folder in a local classmaps checkout.
	for (const dir of localClassmapsDirs(cwd, config)) {
		if (!existsSync(dir)) continue;
		const keys = readdirSync(dir).filter((d) => /^\d{7}$/.test(d)).sort();
		for (let i = keys.length - 1; i >= 0; i--) {
			const file = latestClassmapFile(path.join(dir, keys[i]));
			if (file) return { path: file, key: keys[i] };
		}
	}
	// Back-compat: a plain classmap.json next to the project.
	if (existsSync(path.join(cwd, "classmap.json"))) {
		return { path: path.join(cwd, "classmap.json"), key: "" };
	}
	// Standalone mode: fetch the newest published classmap.
	return fetchRemoteClassmap(null);
}

export function loadConfig(cwd: string): KitConfig {
	const configPath = path.join(cwd, "stitch.config.json");
	if (!existsSync(configPath)) return {};
	try {
		return JSON.parse(readFileSync(configPath, "utf8"));
	} catch {
		return {};
	}
}

// generateClassmapDts emits a global MAP declaration so module sources get
// typed classmap paths without importing anything.
export function generateClassmapDts(classmap: Record<string, unknown>): string {
	const render = (node: Record<string, unknown>, indent: number): string => {
		const pad = "\t".repeat(indent);
		const lines = ["{"];
		for (const key of Object.keys(node).sort()) {
			const value = node[key];
			if (typeof value === "string") {
				lines.push(`${pad}\t${JSON.stringify(key)}: string;`);
			} else {
				lines.push(`${pad}\t${JSON.stringify(key)}: ${render(value as Record<string, unknown>, indent + 1)};`);
			}
		}
		lines.push(`${pad}}`);
		return lines.join("\n");
	};
	return `declare global {\n\tconst MAP: ${render(classmap, 1)};\n}\n\nexport {};\n`;
}
