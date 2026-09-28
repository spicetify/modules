/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * launch - bring up a debuggable Spotify client for the dev loop.
 *
 * Discovers the Spotify binary per platform (mirroring the CLI's
 * restart.go), reuses an already-debuggable instance when one is running
 * on the target port, otherwise kills the running client and spawns a
 * fresh one with --remote-debugging-port. AppX (Microsoft Store) installs
 * are unsupported: the kit cannot supply the spicetify-staged
 * --app-directory without reading CLI config, so launching would yield an
 * unpatched client where hot-push fails right after a "successful" launch.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { portInUseMessage, probePort, type PortProbe } from "./push.ts";

export type SpotifyTarget =
	| { kind: "macos"; app: string }
	| { kind: "windows"; exe: string }
	| { kind: "linux"; exe: string }
	| { kind: "appx" };

const APPX_MESSAGE =
	"Spotify is a Microsoft Store (AppX) install, which the kit cannot launch with a debug port: " +
	"it needs the spicetify-staged --app-directory, which only the CLI knows. " +
	"Start Spotify yourself with --remote-debugging-port, then run `spicetify-kit dev --no-launch`.";

// which returns the resolved path of a command on PATH, or null.
function defaultWhich(cmd: string): string | null {
	try {
		const out = execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
			encoding: "utf8",
		});
		return out.split(/\r?\n/).find(Boolean) ?? null;
	} catch {
		return null;
	}
}

// discoverSpotify resolves the launchable Spotify per platform. Pure over
// its injected probes so it can be unit-tested with a fixture path table.
export function discoverSpotify(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	exists: (p: string) => boolean = existsSync,
	which: (cmd: string) => string | null = defaultWhich,
): SpotifyTarget {
	if (platform === "darwin") {
		const app = "/Applications/Spotify.app";
		if (exists(app)) return { kind: "macos", app };
		throw new Error(
			`Spotify not found at ${app}. Install Spotify, or start it yourself with --remote-debugging-port and run dev with --no-launch.`,
		);
	}
	if (platform === "win32") {
		// win32.join so paths use backslashes on any host (matters for tests).
		const exe = path.win32.join(env.APPDATA ?? "", "Spotify", "Spotify.exe");
		if (exists(exe)) return { kind: "windows", exe };
		const appx = path.win32.join(env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "Spotify.exe");
		if (exists(appx)) return { kind: "appx" };
		throw new Error(
			`Spotify.exe not found (looked in ${exe} and ${appx}). Install the standalone Spotify, or start it yourself with --remote-debugging-port.`,
		);
	}
	const onPath = which("spotify");
	if (onPath) return { kind: "linux", exe: onPath };
	throw new Error(
		"'spotify' not found on PATH. Install Spotify, or start it yourself with --remote-debugging-port and run dev with --no-launch.",
	);
}

// waitForTarget polls until an xpui debug target appears or the timeout
// fires. A foreign listener fails fast instead of burning the whole timeout.
export async function waitForTarget(
	port: string,
	timeoutMs = 30_000,
	probe: (port: string) => Promise<PortProbe> = probePort,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await probe(port);
		if (state.state === "xpui") return;
		if (state.state === "other") throw new Error(portInUseMessage(port, state.what));
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(
		`timed out waiting for a Spotify xpui debug target on port ${port}. ` +
			`Confirm Spotify started with --remote-debugging-port=${port} and that spicetify apply has staged the v3 loader.`,
	);
}

function killRunning(platform: NodeJS.Platform): void {
	try {
		if (platform === "win32") execFileSync("taskkill", ["/F", "/IM", "Spotify.exe"], { stdio: "ignore" });
		else execFileSync("pkill", ["-x", platform === "darwin" ? "Spotify" : "spotify"], { stdio: "ignore" });
	} catch {
		// Not running is fine.
	}
}

function spawnDetached(cmd: string, args: string[]): void {
	// Detached + unref'd so the client survives the kit process (matters on
	// Linux/Windows; macOS `open` already returns immediately).
	const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
	child.unref();
}

// launchSpotify reuses a good client, otherwise (re)starts one with the
// debug port and waits for its xpui target. Returns "reused" or "launched".
export async function launchSpotify(
	port: string,
	log: (msg: string) => void = console.log,
	platform: NodeJS.Platform = process.platform,
	probe: (port: string) => Promise<PortProbe> = probePort,
): Promise<"reused" | "launched"> {
	const state = await probe(port);
	if (state.state === "xpui") {
		log(`[dev] reusing the Spotify client already debuggable on port ${port}`);
		return "reused";
	}
	// Killing Spotify would not free the port, so the relaunch could never bind it.
	if (state.state === "other") throw new Error(portInUseMessage(port, state.what));
	if (state.state === "unknown") throw new Error(portInUseMessage(port, "a process that is not a DevTools endpoint"));
	if (state.state === "spotify") {
		log(`[dev] Spotify is starting on port ${port}, waiting for it`);
		await waitForTarget(port, 30_000, probe);
		return "reused";
	}

	const target = discoverSpotify(platform);
	if (target.kind === "appx") throw new Error(APPX_MESSAGE);

	log(`[dev] (re)starting Spotify with --remote-debugging-port=${port}`);
	killRunning(platform);
	await new Promise((r) => setTimeout(r, 1500));

	const portFlag = `--remote-debugging-port=${port}`;
	if (target.kind === "macos") spawnDetached("open", ["-a", target.app, "--args", portFlag]);
	else spawnDetached(target.exe, [portFlag]);

	await waitForTarget(port, 30_000, probe);
	return "launched";
}
