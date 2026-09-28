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
 * --remote-debugging-port=<port>; dev starts (or reuses) such a client unless
 * --no-launch is passed. Stopping dev removes the override so the client falls
 * back to the staged copy; --keep (and --once) leave it installed, and
 * `spicetify-kit remove` drops it later.
 */

import { watch } from "node:fs";
import path from "node:path";

import { buildModule, readMetadata, resolveModuleDir } from "./build.ts";
import { loadConfig, resolveClassmap, type ClassmapResolution } from "./classmap.ts";
import { launchSpotify, waitForTarget } from "./launch.ts";
import { formatPushResult, formatRemoveOutcome, push, record, removeLocal, resolvePort } from "./push.ts";

// Re-exported for callers that imported it from here before the push extraction.
export { formatPushResult } from "./push.ts";

const USAGE = `spicetify-kit dev <module> [--no-launch] [--keep] [--once] [--port 9229] [--classmap <key|path>] [--out <dir>]
  --no-launch  do not start Spotify; wait for one already running with --remote-debugging-port
  --keep       leave the pushed override installed when dev stops
  --once       build and push once, then exit (the override stays)
  --port       CDP port (default 9229, or SPICETIFY_CDP_PORT)`;

// isSourceChange filters watcher events down to module sources. A standalone
// project's module dir is the project root, so the build's own dist/ output,
// node_modules, and dot-dirs all sit inside the watched tree.
export function isSourceChange(file: string, moduleDir: string, outDir: string): boolean {
	const segments = file.split(/[\\/]/);
	if (segments.some((s) => s.startsWith(".") || s === "node_modules")) return false;
	const rel = path.relative(outDir, path.resolve(moduleDir, file));
	return rel.startsWith("..") || path.isAbsolute(rel);
}

export async function runDev(argv: string[], cwd = process.cwd()): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(USAGE);
		return;
	}
	const valueFlags = new Set(["--port", "--classmap", "--out"]);
	const moduleArg = argv.find((a, i) => !a.startsWith("--") && !valueFlags.has(argv[i - 1]));
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	if (!moduleArg) throw new Error(USAGE);
	const port = resolvePort(flag("port"));
	const once = argv.includes("--once");
	const keep = once || argv.includes("--keep");

	if (argv.includes("--no-launch")) {
		console.log(`[dev] waiting for Spotify on port ${port} (started with --remote-debugging-port=${port})`);
		await waitForTarget(port, Number.POSITIVE_INFINITY);
	} else {
		await launchSpotify(port);
	}

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

	let pushed = false;
	let stopping = false;
	const cycle = async () => {
		if (stopping) return;
		const started = Date.now();
		let distDir: string;
		try {
			// Dev never blocks on standard findings: print them, push anyway.
			distDir = await buildModule(moduleDir, outDir, resolved, cwd, { check: "warn" });
		} catch (e) {
			console.error(`[dev] build failed: ${(e as Error).message}`);
			return;
		}
		if (stopping) return;
		try {
			// Set before the await: a ctrl-c mid-push must still remove what lands.
			pushed = true;
			const raw = await push(record(distDir, id), id, port);
			const result = formatPushResult(raw);
			const line = `[dev] ${id} ${result.message} (${Date.now() - started}ms)`;
			if (result.ok) console.log(line);
			else console.error(line);
		} catch (e) {
			console.error(`[dev] push failed: ${(e as Error).message}`);
		}
	};

	let current: Promise<void> = Promise.resolve();
	let timer: NodeJS.Timeout | undefined;
	const stop = async () => {
		if (stopping) process.exit(130);
		stopping = true;
		clearTimeout(timer);
		await current;
		if (keep || !pushed) process.exit(0);
		try {
			console.log(`[dev] ${formatRemoveOutcome(id, await removeLocal(id, port))}`);
		} catch (e) {
			console.error(`[dev] could not remove the override: ${(e as Error).message}`);
			console.error(`[dev] run \`spicetify-kit remove ${id}\` once Spotify is reachable`);
		}
		process.exit(0);
	};
	process.on("SIGINT", () => void stop());
	process.on("SIGTERM", () => void stop());

	current = cycle();
	await current;
	if (once) return;

	const onExit = keep ? "the override stays installed" : "the override is removed";
	console.log(`[dev] watching ${moduleDir} (ctrl-c to stop; ${onExit})`);
	let loggedDts = false;
	const watcher = watch(moduleDir, { recursive: true }, (_event, file) => {
		if (!file) return;
		// The build regenerates classmap.d.ts into the source dir on every run;
		// reacting to it would loop. Note the skip once so it is not a mystery.
		if (file.endsWith(".d.ts")) {
			if (!loggedDts) {
				console.log("[dev] ignoring generated classmap.d.ts changes");
				loggedDts = true;
			}
			return;
		}
		if (!isSourceChange(file, moduleDir, outDir)) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			current = current.then(cycle);
		}, 200);
	});
	watcher.on("error", (e) => {
		console.error(`[dev] watcher failed: ${e.message}`);
		void stop();
	});
	// Keep the process alive while the watcher runs.
	await new Promise(() => {});
}
