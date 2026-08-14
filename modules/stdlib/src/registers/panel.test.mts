/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../lib/test-setup.mts";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

const panelModule = await import("./panel-logic.ts").catch(() => null);

const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
};

const buildShell = () => {
	document.body.innerHTML = `
		<div class="Root__top-container">
			<div class="Root__nav-bar"></div>
			<main class="Root__main-view"></main>
			<div class="Root__right-sidebar">
				<div class="native-panel"></div>
				<div data-testid="LayoutResizer__resize-bar"></div>
			</div>
		</div>`;
	return {
		top: document.querySelector<HTMLElement>(".Root__top-container")!,
		sidebar: document.querySelector<HTMLElement>(".Root__right-sidebar")!,
		native: document.querySelector<HTMLElement>(".native-panel")!,
		resizer: document.querySelector<HTMLElement>("[data-testid='LayoutResizer__resize-bar']")!,
	};
};

describe("owned panel coordinator", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("exclusively opens registered panels and restores native sidebar state", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		const shell = buildShell();
		shell.top.style.setProperty("grid-template-columns", "11px 1fr 22px", "important");
		shell.sidebar.style.setProperty("width", "22px");
		shell.sidebar.style.setProperty("min-width", "10px");
		const lifecycle: string[] = [];
		const mounted: string[] = [];
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount(host, panel, close) {
				host.textContent = panel.label;
				host.dataset.closeReady = String(typeof close === "function");
				mounted.push(panel.id);
				return () => {
					host.textContent = "";
				};
			},
		});
		const first = coordinator.register({
			id: "first",
			label: "First panel",
			render: () => null,
			onOpen: () => lifecycle.push("first:open"),
			onClose: () => lifecycle.push("first:close"),
		});
		const second = coordinator.register({
			id: "second",
			label: "Second panel",
			render: () => null,
			onOpen: () => lifecycle.push("second:open"),
			onClose: () => lifecycle.push("second:close"),
		});

		first.open();
		assert.equal(first.isOpen(), true);
		assert.equal(shell.native.hidden, true);
		assert.equal(shell.native.inert, true);
		assert.equal(shell.resizer.hidden, true);
		assert.equal(shell.top.dataset.spicetifyPanelActive, "");
		assert.equal(shell.top.style.getPropertyValue("--spicetify-panel-requested-width"), "360px");
		assert.equal(
			shell.top.style.getPropertyValue("grid-template-columns"),
			"auto minmax(0, 1fr) var(--spicetify-panel-width)",
		);
		assert.equal(shell.top.style.getPropertyPriority("grid-template-columns"), "important");
		assert.equal(shell.sidebar.style.getPropertyValue("width"), "var(--spicetify-panel-width)");
		assert.equal(shell.sidebar.style.getPropertyPriority("width"), "important");
		assert.equal(shell.sidebar.querySelector(".spicetify-panel-host")?.textContent, "First panel");

		second.open();
		assert.equal(first.isOpen(), false);
		assert.equal(second.isOpen(), true);
		assert.equal(shell.native.hidden, true);
		assert.equal(shell.sidebar.querySelector(".spicetify-panel-host")?.textContent, "Second panel");
		assert.deepEqual(lifecycle, ["first:open", "first:close", "second:open"]);
		assert.deepEqual(mounted, ["first", "second"]);

		second.close();
		assert.equal(shell.native.hidden, false);
		assert.equal(shell.native.inert, false);
		assert.equal(shell.resizer.hidden, false);
		assert.equal(shell.top.hasAttribute("data-spicetify-panel-active"), false);
		assert.equal(shell.top.style.getPropertyValue("--spicetify-panel-requested-width"), "");
		assert.equal(shell.top.style.getPropertyValue("grid-template-columns"), "11px 1fr 22px");
		assert.equal(shell.top.style.getPropertyPriority("grid-template-columns"), "important");
		assert.equal(shell.sidebar.style.getPropertyValue("width"), "22px");
		assert.equal(shell.sidebar.style.getPropertyValue("min-width"), "10px");
		assert.equal(shell.sidebar.querySelector(".spicetify-panel-host"), null);
		assert.deepEqual(lifecycle, ["first:open", "first:close", "second:open", "second:close"]);
	});

	it("closes on Escape, restores focus, and removes an active registration", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		buildShell();
		const opener = document.createElement("button");
		document.body.append(opener);
		opener.focus();
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount: () => () => {},
		});
		const panel = coordinator.register({ id: "focus", label: "Focus", render: () => null });

		panel.open();
		const overlay = document.createElement("div");
		overlay.className = "spicetify-popover";
		document.body.append(overlay);
		const consumeOverlayEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			overlay.remove();
		};
		document.addEventListener("keydown", consumeOverlayEscape, { capture: true, once: true });
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
		assert.equal(panel.isOpen(), true, "the top-layer overlay owns the first Escape");
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		assert.equal(panel.isOpen(), false);
		assert.equal(document.activeElement, opener);

		panel.open();
		panel.dispose();
		assert.equal(panel.isOpen(), false);
		assert.equal(document.querySelector(".spicetify-panel-host"), null);
		assert.throws(() => panel.open(), /disposed/);
	});

	it("preserves the original opener when one custom panel replaces another", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		buildShell();
		const opener = document.createElement("button");
		document.body.append(opener);
		opener.focus();
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount: () => () => {},
		});
		const first = coordinator.register({ id: "first-focus", label: "First", render: () => null });
		const second = coordinator.register({ id: "second-focus", label: "Second", render: () => null });

		first.open();
		second.open();
		second.close();
		assert.equal(document.activeElement, opener);
	});

	it("suspends native children added or replaced while a panel is open", async () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		const shell = buildShell();
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount: () => () => {},
		});
		const panel = coordinator.register({ id: "replace", label: "Replace", render: () => null });
		panel.open();

		const lateChild = document.createElement("div");
		shell.sidebar.append(lateChild);
		await settle();
		assert.equal(lateChild.hidden, true);
		assert.equal(lateChild.inert, true);

		const replacement = document.createElement("div");
		replacement.className = "Root__right-sidebar";
		const replacementNative = document.createElement("div");
		replacement.append(replacementNative);
		shell.sidebar.replaceWith(replacement);
		await settle();
		assert.equal(replacementNative.hidden, true);
		assert.ok(replacement.querySelector(".spicetify-panel-host"));

		panel.close();
		assert.equal(replacementNative.hidden, false);
		assert.equal(replacementNative.inert, false);
	});

	it("clamps configured width and rejects duplicate panel ids", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		buildShell();
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount: () => () => {},
		});
		const panel = coordinator.register({
			id: "sized",
			label: "Sized",
			render: () => null,
			width: { default: 900, min: 280, max: 520 },
		});
		assert.throws(
			() => coordinator.register({ id: "sized", label: "Duplicate", render: () => null }),
			/duplicate panel id/,
		);
		for (const width of [{ default: Number.NaN }, { min: -1 }, { max: Number.POSITIVE_INFINITY }]) {
			assert.throws(
				() =>
					coordinator.register({
						id: `invalid-${String(Object.values(width)[0])}`,
						label: "Invalid",
						render: () => null,
						width,
					}),
				/panel width .*finite non-negative number/,
			);
		}

		panel.open();
		assert.equal(
			document
				.querySelector<HTMLElement>(".Root__top-container")!
				.style.getPropertyValue("--spicetify-panel-requested-width"),
			"520px",
		);
		panel.close();
	});

	it("contains lifecycle callback failures and remains usable", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		const shell = buildShell();
		const errors: unknown[] = [];
		const originalError = console.error;
		console.error = (...values) => errors.push(values);
		try {
			const coordinator = panelModule!.createPanelCoordinator({
				document,
				window,
				mount: () => () => {},
			});
			const broken = coordinator.register({
				id: "broken-callback",
				label: "Broken callback",
				render: () => null,
				onClose: () => {
					throw new Error("callback failed");
				},
			});
			const healthy = coordinator.register({ id: "healthy", label: "Healthy", render: () => null });
			broken.open();

			assert.doesNotThrow(() => healthy.open());
			assert.equal(healthy.isOpen(), true);
			healthy.close();
			assert.equal(shell.native.hidden, false);
			assert.equal(errors.length, 1);
		} finally {
			console.error = originalError;
		}
	});

	it("rolls back a renderer failure so another panel can open", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		const shell = buildShell();
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount(_host, panel) {
				if (panel.id === "broken-renderer") throw new Error("mount failed");
				return () => {};
			},
		});
		const broken = coordinator.register({ id: "broken-renderer", label: "Broken", render: () => null });
		const healthy = coordinator.register({ id: "healthy-renderer", label: "Healthy", render: () => null });

		assert.throws(() => broken.open(), /mount failed/);
		assert.equal(broken.isOpen(), false);
		assert.doesNotThrow(() => healthy.open());
		assert.equal(healthy.isOpen(), true);
		healthy.close();
		assert.equal(shell.native.hidden, false);
	});

	it("disposes the coordinator and rejects work from a stale generation", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		const shell = buildShell();
		let unmounted = 0;
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount: () => () => {
				unmounted += 1;
			},
		});
		const panel = coordinator.register({ id: "stale", label: "Stale", render: () => null });
		panel.open();

		coordinator.dispose();
		assert.equal(unmounted, 1);
		assert.equal(shell.native.hidden, false);
		assert.equal(document.querySelector(".spicetify-panel-host"), null);
		assert.throws(() => panel.open(), /disposed/);
		assert.throws(() => coordinator.register({ id: "late", label: "Late", render: () => null }), /disposed/);
	});

	it("contains subscriber and unmount failures while restoring the shell", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		const shell = buildShell();
		const errors: unknown[] = [];
		const originalError = console.error;
		console.error = (...values) => errors.push(values);
		try {
			const coordinator = panelModule!.createPanelCoordinator({
				document,
				window,
				mount: () => () => {
					throw new Error("unmount failed");
				},
			});
			const panel = coordinator.register({ id: "cleanup", label: "Cleanup", render: () => null });
			assert.doesNotThrow(() =>
				panel.subscribe(() => {
					throw new Error("subscriber failed");
				}),
			);
			panel.open();

			assert.doesNotThrow(() => panel.close());
			assert.equal(shell.native.hidden, false);
			assert.equal(document.querySelector(".spicetify-panel-host"), null);
			assert.ok(errors.length >= 3);
		} finally {
			console.error = originalError;
		}
	});

	it("serializes panel requests made from lifecycle callbacks", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		buildShell();
		const coordinator = panelModule!.createPanelCoordinator({
			document,
			window,
			mount(host, panel) {
				host.textContent = panel.label;
				return () => {};
			},
		});
		let first: ReturnType<typeof coordinator.register>;
		let reopen = true;
		first = coordinator.register({
			id: "reentrant-first",
			label: "First",
			render: () => null,
			onClose: () => {
				if (!reopen) return;
				reopen = false;
				first.open();
			},
		});
		const second = coordinator.register({ id: "reentrant-second", label: "Second", render: () => null });
		first.open();

		second.open();
		assert.equal(first.isOpen(), true, "the callback's later request should win");
		assert.equal(second.isOpen(), false);
		assert.equal(document.querySelectorAll(".spicetify-panel-host").length, 1);
		assert.equal(document.querySelector(".spicetify-panel-host")?.textContent, "First");
		coordinator.dispose();
	});

	it("drains disposal after a lifecycle callback queues open then dispose", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		buildShell();
		const coordinator = panelModule!.createPanelCoordinator({ document, window, mount: () => () => {} });
		let other: ReturnType<typeof coordinator.register>;
		const first = coordinator.register({
			id: "queue-owner",
			label: "Queue owner",
			render: () => null,
			onClose: () => {
				other.open();
				other.dispose();
			},
		});
		other = coordinator.register({ id: "queued-disposal", label: "Queued disposal", render: () => null });
		first.open();

		assert.doesNotThrow(() => first.close());
		assert.doesNotThrow(() =>
			coordinator.register({ id: "queued-disposal", label: "Replacement", render: () => null }),
		);
		coordinator.dispose();
	});

	it("preserves a theme-owned trailing shell track and includes it in the width budget", () => {
		assert.equal(typeof panelModule?.createPanelCoordinator, "function", "owned coordinator is not implemented");
		const shell = buildShell();
		shell.top.style.gridTemplateColumns = "72px 1fr 32px 200px";
		const coordinator = panelModule!.createPanelCoordinator({ document, window, mount: () => () => {} });
		const panel = coordinator.register({ id: "four-column", label: "Four column", render: () => null });

		panel.open();
		assert.equal(
			shell.top.style.getPropertyValue("grid-template-columns"),
			"auto minmax(0, 1fr) var(--spicetify-panel-width) 200px",
		);
		assert.equal(shell.top.style.getPropertyValue("--spicetify-panel-trailing-width"), "200px");

		panel.close();
		assert.equal(shell.top.style.getPropertyValue("grid-template-columns"), "72px 1fr 32px 200px");
		assert.equal(shell.top.style.getPropertyValue("--spicetify-panel-trailing-width"), "");
	});
});
