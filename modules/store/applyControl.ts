/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DAEMON, el, stdlibDiskStaged } from "./runtime.ts";
import { clearSettledStdlibMarker } from "./updates.ts";

export const APPLY_URI = "spicetify:0:apply";
const HEALTH_TIMEOUT_MS = 3000;
const RESTART_TIMEOUT_MS = 30000;

type Transport = "daemon" | "app";
type State =
	| { kind: "checking" }
	| { kind: "ready"; transport: Transport }
	| { kind: "confirm"; transport: Transport }
	| { kind: "waiting"; transport: Transport }
	| { kind: "error"; message: string };

// The registered app handler exists on desktop targets, not on web/mobile.
export function supportsAppHandoff(userAgent = globalThis.navigator?.userAgent ?? ""): boolean {
	return /Spotify\//i.test(userAgent) && /Macintosh|Windows NT|Linux (?:x86_64|aarch64)/i.test(userAgent);
}

// Plain DOM so recovery survives a broken stdlib or React capture too.
export function createApplyControl() {
	const node = el("section", "spicetify-store-apply");
	node.setAttribute("aria-label", "Spicetify updates and recovery");
	const message = el("p");
	message.setAttribute("role", "status");
	message.setAttribute("aria-live", "polite");
	const actions = el("div", "spicetify-store-apply-actions");
	node.append(message, actions);
	let state: State = { kind: "checking" };
	let disposed = false;
	let checking = false;
	let restartTimer: ReturnType<typeof setTimeout> | undefined;
	let handoffTimer: ReturnType<typeof setTimeout> | undefined;
	const healthTimers = new Set<ReturnType<typeof setTimeout>>();

	function button(label: string, onClick: () => void) {
		const control = el("button", "spicetify-store-cta", label);
		control.type = "button";
		control.addEventListener("click", onClick);
		actions.append(control);
		return control;
	}

	function setState(next: State) {
		if (disposed) return;
		state = next;
		render();
	}

	function waitForRestart(transport: Transport) {
		setState({ kind: "waiting", transport });
		restartTimer = setTimeout(() => {
			setState({
				kind: "error",
				message:
					transport === "app"
						? "Spotify has not restarted. If an Open Spicetify prompt appeared, accept it. If nothing opened, the Spicetify app handler may be missing or unavailable."
						: "The apply request was sent, but Spotify has not restarted. It may still be running; check the connection before trying again.",
			});
		}, RESTART_TIMEOUT_MS);
	}

	async function applyViaDaemon() {
		const api = DAEMON();
		if (!api?.apply) {
			setState({
				kind: "error",
				message: "This client cannot send an apply request. Open the Spicetify app instead.",
			});
			return;
		}
		waitForRestart("daemon");
		try {
			await api.apply();
		} catch (error) {
			clearTimeout(restartTimer);
			setState({
				kind: "error",
				message: `Apply failed: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	function render() {
		const hadFocus = node.contains(document.activeElement);
		actions.replaceChildren();
		node.hidden = false;
		const staged = stdlibDiskStaged();
		switch (state.kind) {
			case "checking":
				message.textContent = "Checking the Spicetify service…";
				break;
			case "ready": {
				if (!staged && state.transport === "daemon") {
					node.hidden = true;
					break;
				}
				const transport = state.transport;
				message.textContent =
					transport === "app"
						? "The Spicetify service is unavailable. Open the installed Spicetify app to apply changes and restore the connection. Spotify will restart."
						: `stdlib ${staged} is staged. Apply it to restart Spotify with the update.`;
				if (transport === "daemon" || supportsAppHandoff()) {
					button(transport === "daemon" ? "Apply stdlib update" : "Repair Spicetify", () =>
						setState({ kind: "confirm", transport }),
					);
				} else {
					message.textContent += " App recovery is available only in the Spotify desktop client.";
				}
				button("Check connection", () => void refresh());
				break;
			}
			case "confirm": {
				const transport = state.transport;
				message.textContent =
					"Apply changes and restart Spotify? Playback will stop. Your modules and preferences will be kept.";
				if (transport === "app") {
					const link = el("a", "spicetify-store-cta", "Open Spicetify and restart");
					link.href = APPLY_URI;
					link.target = "_blank";
					link.rel = "noopener noreferrer";
					// Keep the real link's default action: the OS, not page JS,
					// launches the registered app during this user gesture.
					link.addEventListener("click", (event) => {
						if (handoffTimer !== undefined) {
							event.preventDefault();
							return;
						}
						// The anchor must remain connected through the native default action.
						handoffTimer = setTimeout(() => {
							handoffTimer = undefined;
							waitForRestart("app");
						}, 0);
					});
					actions.append(link);
				} else {
					button("Apply and restart", () => void applyViaDaemon());
				}
				button("Cancel", () => setState({ kind: "ready", transport }));
				break;
			}
			case "waiting":
				message.textContent =
					state.transport === "app"
						? "Opening the Spicetify app. Accept the Open Spicetify prompt if shown, then wait for Spotify to restart."
						: "Apply requested. Waiting for Spotify to restart…";
				break;
			case "error":
				message.textContent = state.message;
				button("Check connection", () => void refresh());
				if (supportsAppHandoff()) {
					button("Open Spicetify app instead", () => setState({ kind: "confirm", transport: "app" }));
				}
				break;
		}
		if (hadFocus) actions.querySelector<HTMLElement>("button, a")?.focus();
	}

	async function refresh(background = false) {
		if (disposed || checking || state.kind === "waiting" || state.kind === "confirm") return;
		if (background && state.kind === "error") return;
		checking = true;
		clearTimeout(restartTimer);
		clearSettledStdlibMarker();
		setState({ kind: "checking" });
		const api = DAEMON();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const reachable =
				!!api?.apply &&
				(await Promise.race([
					Promise.resolve().then(() => api.available()),
					new Promise<boolean>((resolve) => {
						timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);
						healthTimers.add(timer);
					}),
				]));
			if (disposed) return;
			clearSettledStdlibMarker();
			setState({ kind: "ready", transport: reachable ? "daemon" : "app" });
		} catch {
			setState({ kind: "ready", transport: "app" });
		} finally {
			checking = false;
			clearTimeout(timer);
			if (timer) healthTimers.delete(timer);
		}
	}

	render();
	return {
		node,
		refresh,
		dispose() {
			disposed = true;
			clearTimeout(handoffTimer);
			clearTimeout(restartTimer);
			for (const timer of healthTimers) clearTimeout(timer);
			healthTimers.clear();
			node.remove();
		},
	};
}
