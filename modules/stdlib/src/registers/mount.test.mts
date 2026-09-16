/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../lib/test-setup.mts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, it } from "node:test";
import * as React from "react";
import { Registry } from "./registry.ts";

// Spotify supplies these instances through webpack capture. Exercise the real
// React renderer here, replacing only that unavailable client boundary.
const reactExposure = `
export * as React from ${JSON.stringify(import.meta.resolve("react"))};
import * as DOM from ${JSON.stringify(import.meta.resolve("react-dom"))};
import { createRoot } from ${JSON.stringify(import.meta.resolve("react-dom/client"))};
export const ReactDOM = { ...DOM, createRoot };
`;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "../expose/React.ts" && context.parentURL === new URL("./mount.ts", import.meta.url).href) {
			return { url: `data:text/javascript,${encodeURIComponent(reactExposure)}`, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
const chunks = { xpui: { promise: Promise.resolve() } };
Object.assign(globalThis, { CHUNKS: chunks, IS_REACT_ACT_ENVIRONMENT: true });
const { mountAdjacent, mountRegistryAnchor } = await import("./mount.ts");
hooks.deregister();

const flushMutation = async () => {
	await React.act(async () => {
		await new Promise<void>((resolve) => {
			const observer = new MutationObserver(() => {
				observer.disconnect();
				resolve();
			});
			observer.observe(document.body, { childList: true, subtree: true });
			document.body.append(document.createElement("i"));
		});
		await delay(0);
	});
};

afterEach(() => {
	document.body.replaceChildren();
	chunks.xpui.promise = Promise.resolve();
});

it("disables adjacent items permanently and re-enables exactly one host", async (t) => {
	document.body.innerHTML = '<div><button id="native">Native</button></div>';
	let mounted = 0;
	let unmounted = 0;
	const Button = () => {
		React.useEffect(() => {
			mounted++;
			return () => {
				unmounted++;
			};
		}, []);
		return React.createElement("button", null, "Module");
	};
	const enable = () =>
		mountAdjacent({
			className: "test-adjacent",
			element: React.createElement(Button),
			findTarget: () => document.querySelector("#native"),
			side: "after",
			giveUpMs: 1000,
			onGiveUp: () => assert.fail("native target is available"),
		});
	const active: ReturnType<typeof enable>[] = [];
	t.after(async () => {
		await React.act(async () => {
			for (const item of active) item.remove();
		});
	});
	await React.act(async () => {
		active.push(enable());
	});
	assert.equal(mounted, 1);
	const original = document.querySelector(".test-adjacent");
	assert.ok(original);
	original.remove();
	await flushMutation();
	assert.equal(original.isConnected, true, "active items survive native reconciliation");
	assert.equal(mounted, 1, "re-placement must preserve the React root");

	await React.act(async () => {
		active[0].remove();
		active[0].remove();
	});
	await flushMutation();
	assert.equal(original.isConnected, false, "disabled hosts must not be reinserted by the observer");
	assert.equal(unmounted, 1, "disable is idempotent");

	await React.act(async () => {
		active.push(enable());
	});
	await flushMutation();
	assert.equal(document.querySelectorAll(".test-adjacent").length, 1);
	assert.equal(document.querySelector(".test-adjacent")?.textContent, "Module");
	assert.equal(mounted, 2);
	assert.equal(original.isConnected, false);
});

it("keeps watching an active neighbor when another adjacent item is disabled", async (t) => {
	document.body.innerHTML = '<div><button id="native">Native</button></div>';
	const active: ReturnType<typeof mountAdjacent>[] = [];
	t.after(async () => {
		await React.act(async () => {
			for (const item of active) item.remove();
		});
	});
	await React.act(async () => {
		for (const className of ["test-first", "test-second"]) {
			active.push(
				mountAdjacent({
					className,
					element: React.createElement("button", null, className),
					findTarget: () => document.querySelector("#native"),
					side: "before",
					giveUpMs: 1000,
					onGiveUp: () => assert.fail("native target is available"),
				}),
			);
		}
	});
	const first = document.querySelector(".test-first");
	const second = document.querySelector(".test-second");
	assert.ok(first && second);
	await React.act(async () => {
		active[0].remove();
	});
	second.remove();
	await flushMutation();
	assert.equal(first.isConnected, false);
	assert.equal(second.isConnected, true, "another registration still owns the shared observer");
	assert.equal(second.textContent, "test-second");
});

it("does not mount an adjacent item disabled before client capture", async () => {
	const ready = Promise.withResolvers<void>();
	chunks.xpui.promise = ready.promise;
	document.body.innerHTML = '<button id="native">Native</button>';
	const adjacent = mountAdjacent({
		className: "test-cancelled",
		element: React.createElement("button", null, "Cancelled"),
		findTarget: () => document.querySelector("#native"),
		side: "before",
		giveUpMs: 1000,
		onGiveUp: () => assert.fail("disabled items must not fall back"),
	});
	adjacent.remove();
	await React.act(async () => {
		ready.resolve();
	});
	await flushMutation();
	assert.equal(document.querySelector(".test-cancelled"), null);
});

it("keeps a healthy registration's state when a failed neighbor is removed and re-enabled", async (t) => {
	document.body.innerHTML = '<div id="registry-slot"></div>';
	const errors: unknown[][] = [];
	t.mock.method(console, "error", (...values: unknown[]) => {
		errors.push(values);
	});
	let shouldFail = true;
	const Broken = () => {
		if (shouldFail) throw new Error("broken registration");
		return React.createElement("span", { "data-recovered": "" }, "Recovered");
	};
	let healthyMounts = 0;
	let healthyUnmounts = 0;
	const Healthy = () => {
		const [count, setCount] = React.useState(0);
		React.useEffect(() => {
			healthyMounts++;
			return () => {
				healthyUnmounts++;
			};
		}, []);
		return React.createElement("button", { onClick: () => setCount(count + 1) }, `Healthy ${count}`);
	};
	// Keys belong to separate registering modules, so collisions are valid.
	const broken = React.createElement(Broken, { key: "default" });
	const healthy = React.createElement(Healthy, { key: "default" });
	const registry = new Registry<React.ReactElement>([broken, healthy]);
	let refresh: (() => void) | undefined;
	t.after(async () => {
		await React.act(async () => {
			registry.clear();
			refresh?.();
		});
	});
	await React.act(async () => {
		mountRegistryAnchor({
			className: "test-registry",
			registry,
			setRefresh: (callback) => {
				refresh = callback;
			},
			findSlot: () => {
				const parent = document.querySelector("#registry-slot");
				return parent ? { parent } : null;
			},
		});
	});
	const button = document.querySelector<HTMLButtonElement>(".test-registry button");
	assert.ok(button);
	await React.act(async () => {
		button.click();
	});
	assert.equal(button.textContent, "Healthy 1");
	assert.equal(document.querySelectorAll(".test-registry [title]").length, 1);
	assert.ok(errors.some((values) => values.some((value) => String(value).includes("broken registration"))));

	await React.act(async () => {
		registry.delete(broken);
		refresh?.();
	});
	assert.ok(document.querySelector(".test-registry button") === button, "healthy DOM and state must survive");
	assert.equal(button.textContent, "Healthy 1");
	assert.equal(document.querySelectorAll(".test-registry [title]").length, 0);
	assert.equal(healthyMounts, 1);
	assert.equal(healthyUnmounts, 0);

	shouldFail = false;
	await React.act(async () => {
		registry.add(broken);
		refresh?.();
	});
	assert.ok(document.querySelector(".test-registry button") === button);
	assert.equal(button.textContent, "Healthy 1");
	assert.equal(document.querySelectorAll(".test-registry [title]").length, 0);
	assert.equal(document.querySelector(".test-registry [data-recovered]")?.textContent, "Recovered");
	assert.equal(healthyMounts, 1);
	assert.equal(healthyUnmounts, 0);
});
