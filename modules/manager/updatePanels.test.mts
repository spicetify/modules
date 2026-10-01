/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { transformSync } from "rolldown/experimental";

import type { DaemonInfo } from "./autoUpdate.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const client: { modules?: unknown; daemon?: unknown; snackbar?: unknown } = {};
Object.assign(globalThis, { managerPanelsTest: { client } });
const exposure = `
export * as React from ${JSON.stringify(import.meta.resolve("react"))};
export const client = globalThis.managerPanelsTest.client;
`;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "/modules/stdlib/mod.ts") {
			return { url: `data:text/javascript,${encodeURIComponent(exposure)}`, shortCircuit: true };
		}
		if (specifier === "/modules/stdlib/lib/primitives.js") {
			const primitives = "export const TextInput = () => null;";
			return { url: `data:text/javascript,${encodeURIComponent(primitives)}`, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url.startsWith("file:") && url.endsWith(".tsx")) {
			const filename = fileURLToPath(url);
			const result = transformSync(filename, readFileSync(filename, "utf8"), { jsx: { runtime: "automatic" } });
			assert.equal(result.errors.length, 0);
			return { format: "module", source: result.code, shortCircuit: true };
		}
		return nextLoad(url, context);
	},
});
const { SpicetifySelfUpdate } = await import("./selfUpdate.tsx");
const { ManagerPage } = await import("./page.tsx");
hooks.deregister();

const APPLIED = "3.0.0-beta.21";
const INSTALLED = "3.0.0-beta.22";
const PROMPT = `Spicetify ${INSTALLED} is installed. Apply to use it in Spotify.`;
const TOGGLE = "Install Spicetify updates automatically";

const text = (node: ReactTestInstance | string): string =>
	typeof node === "string" ? node : node.children.map(text).join("");

const toggle = (root: ReactTestInstance) =>
	root.findAll((node) => node.type === "label" && text(node).includes(TOGGLE));

const prompt = (root: ReactTestInstance) => root.findAll((node) => node.type === "p" && text(node) === PROMPT);

// The section headed "Updates", whichever panel rendered it.
const updatesSection = (root: ReactTestInstance) => {
	const sections = root.findAll(
		(node) => node.type === "section" && node.findAll((h) => h.type === "h2" && text(h) === "Updates").length > 0,
	);
	assert.equal(sections.length, 1);
	return sections[0]!;
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const renderers: ReactTestRenderer[] = [];
async function render(element: React.ReactElement) {
	let tree!: ReactTestRenderer;
	await act(async () => {
		tree = create(element);
	});
	await act(flush);
	renderers.push(tree);
	return tree.root;
}

afterEach(async () => {
	await act(async () => renderers.splice(0).forEach((tree) => tree.unmount()));
});

const selfUpdateProps = (daemonInfo: DaemonInfo | null, setAutoUpdate?: (on: boolean) => Promise<unknown>) => ({
	daemon: { apply: async () => {}, ...(setAutoUpdate ? { setAutoUpdate } : {}) },
	daemonInfo,
	setDaemonInfo: () => {},
	cliVersion: APPLIED,
	busy: false,
	onAction: () => {},
});

describe("SpicetifySelfUpdate", () => {
	it("offers the toggle and the apply prompt when the daemon reports both", async () => {
		const root = await render(
			React.createElement(
				SpicetifySelfUpdate,
				selfUpdateProps({ version: INSTALLED, autoUpdate: true }, async () => {}),
			),
		);
		assert.equal(toggle(root).length, 1);
		assert.equal(prompt(root).length, 1);
	});

	it("leaves the toggle out when the daemon predates the setting", async () => {
		const root = await render(
			React.createElement(SpicetifySelfUpdate, selfUpdateProps({ version: INSTALLED, autoUpdate: null })),
		);
		assert.equal(toggle(root).length, 0);
		assert.equal(prompt(root).length, 1, "the apply prompt only needs the version");
	});
});

describe("Manager update panels", () => {
	const originalFetch = globalThis.fetch;
	let manifest: Record<string, unknown>;

	beforeEach(() => {
		manifest = { cliVersion: APPLIED, spotifyVersion: "1.2.96.518", supportedSpotify: "1.2.96.518" };
		Object.assign(globalThis, {
			Spicetify: { Modules: { manifest, list: () => [] } },
			fetch: async () => ({ ok: false }),
		});
	});

	afterEach(() => {
		Object.assign(globalThis, { fetch: originalFetch });
		delete (globalThis as { Spicetify?: unknown }).Spicetify;
		delete client.daemon;
	});

	const daemon = (info: DaemonInfo, withSetting: boolean) => ({
		available: async () => true,
		daemonInfo: async () => info,
		updateAndApplySupported: async () => true,
		apply: async () => {},
		blockUpdates: async () => {},
		unblockUpdates: async () => {},
		managedSpotify: { status: async () => null, check: async () => ({ kind: "current" }) },
		...(withSetting ? { setAutoUpdate: async () => {} } : {}),
	});

	for (const panel of ["regular", "managed Linux"] as const) {
		const setup = () => {
			if (panel === "managed Linux") manifest.managedSpotify = "stable";
		};

		it(`the ${panel} panel shows the toggle and the apply prompt`, async () => {
			setup();
			client.daemon = daemon({ version: INSTALLED, autoUpdate: true }, true);
			const section = updatesSection(await render(React.createElement(ManagerPage)));
			assert.equal(
				section.findAll((node) => text(node).startsWith("Linux stable") && node.type === "span").length,
				panel === "managed Linux" ? 1 : 0,
			);
			assert.equal(toggle(section).length, 1);
			assert.equal(prompt(section).length, 1);
		});

		it(`the ${panel} panel leaves the toggle out when the daemon predates the setting`, async () => {
			setup();
			client.daemon = daemon({ version: INSTALLED, autoUpdate: null }, false);
			const section = updatesSection(await render(React.createElement(ManagerPage)));
			assert.equal(toggle(section).length, 0);
			assert.equal(prompt(section).length, 1);
		});
	}
});
