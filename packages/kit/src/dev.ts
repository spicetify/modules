/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * dev - hot-push a module into a running Spotify client.
 *
 * Watches the module's sources; on change it rebuilds and pushes the
 * fresh bundle over the Chrome DevTools Protocol as a local install
 * (Spicetify.Modules.installLocal), so nothing in the staged app bundle
 * is touched and the loop is sub-second. Spotify must be running with
 * --remote-debugging-port=<port>. Remove the override afterwards with
 * Spicetify.Modules.removeLocal("<name>") (or from the manager page) to
 * fall back to the staged copy.
 */

import { watch } from "node:fs";
import path from "node:path";

import { buildModule, readMetadata, resolveModuleDir } from "./build.ts";
import { loadConfig, resolveClassmap, type ClassmapResolution } from "./classmap.ts";
import { launchSpotify } from "./launch.ts";
import { formatPushResult, push, record } from "./push.ts";

// Re-exported for callers that imported it from here before the push extraction.
export { formatPushResult } from "./push.ts";

const USAGE =
	"spicetify-kit dev <module> [--launch] [--port 9229] [--once] [--classmap <key|path>] [--out <dir>]\n" +
	"  --launch   start (or reuse) Spotify with the remote-debugging port itself";

export async function runDev(argv: string[], cwd = process.cwd()): Promise<void> {
	const moduleArg = argv.find((a) => !a.startsWith("--"));
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	if (!moduleArg) throw new Error(USAGE);
	const port = flag("port") ?? "9229";
	const once = argv.includes("--once");

	if (argv.includes("--launch")) await launchSpotify(port);

	const config = loadConfig(cwd);
	const modulesDir = config.modulesDir ? path.resolve(cwd, config.modulesDir) : path.join(cwd, "modules");
	const outDir = flag("out") ?? (config.outDir ? path.resolve(cwd, config.outDir) : path.join(cwd, "dist"));
	const moduleDir = resolveModuleDir(moduleArg, modulesDir, cwd);
	const id = readMetadata(moduleDir).name;

	const resolved: ClassmapResolution = await resolveClassmap({
		flag: flag("classmap") ?? null,
		config,
		cwd,
		refresh: argv.includes("--refresh"),
	});
	if (!resolved.path) throw new Error("no classmap found (pass --classmap <key|path>)");

	const cycle = async () => {
		const started = Date.now();
		let distDir: string;
		try {
			// Dev never blocks on standard findings: print them, push anyway.
			distDir = await buildModule(moduleDir, outDir, resolved, cwd, { check: "warn" });
		} catch (e) {
			console.error(`[dev] build failed: ${(e as Error).message}`);
			return;
		}
		try {
			const raw = await push(record(distDir, id), id, port);
			const result = formatPushResult(raw);
			const line = `[dev] ${id} ${result.message} (${Date.now() - started}ms)`;
			if (result.ok) console.log(line);
			else console.error(line);
		} catch (e) {
			console.error(`[dev] push failed: ${(e as Error).message}`);
		}
	};

	await cycle();
	if (once) return;

	console.log(`[dev] watching ${moduleDir} (ctrl-c to stop; removeLocal("${id}") drops the override)`);
	let timer: NodeJS.Timeout | undefined;
	watch(moduleDir, { recursive: true }, (_event, file) => {
		// The build regenerates classmap.d.ts into the source dir on every
		// run; reacting to it would loop forever.
		if (!file || file.endsWith(".d.ts") || file.startsWith(".")) return;
		clearTimeout(timer);
		timer = setTimeout(() => void cycle(), 200);
	});
	// Keep the process alive while the watcher runs.
	await new Promise(() => {});
}
