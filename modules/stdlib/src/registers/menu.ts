/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";

import { matchLast } from "/hooks/util.ts";

import { warn } from "../logger.ts";
import { transformer } from "../../mixin.ts";
import { Registry } from "./registry.ts";

type __MenuContext = React.Context<MenuContext>;

declare global {
	var __MenuContext: __MenuContext;
}

type MenuContext = {
	props: any;
	trigger: string;
	target: HTMLElement;
};

const items = new Registry<React.ReactNode>();
export default items;

export const useMenuItem = () => React.useContext(globalThis.__MenuContext);

declare global {
	var __renderMenuItems: any;
}

globalThis.__renderMenuItems = () => items.all();
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(/("Menu".+?children:)([a-zA-Z_\$][\w\$]*)/, "$1[__renderMenuItems(),$2].flat()");

		const croppedInput = str.match(/.*value:"contextmenu"/)![0];
		const react = matchLast(croppedInput, /([a-zA-Z_\$][\w\$]*)\.useRef/g)[1];

		const [, menu, trigger, target] =
			matchLast(
				croppedInput,
				/\(\{[^}]*menu:([a-zA-Z_\$][\w\$]*),[^}]*trigger:([a-zA-Z_\$][\w\$]*),[^}]*triggerRef:([a-zA-Z_\$][\w\$]*)/g,
			) ?? [];

		let value: string;
		if (menu && trigger && target) {
			value = `{props:${menu}?.props,trigger:${trigger},target:${target}}`;
		} else {
			value = `{props:e.menu?.props,trigger:e.trigger,target:e.triggerRef}`;
		}

		str = str.replace(
			/render:(.{0,100}?\(0,([a-zA-Z_\$][\w\$]*)\.jsx\)\([a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*,\{value:"contextmenu",[^\}]+\}[^,]+),/,
			`render:(props)=>{const value=${value};return ($2.jsx)((globalThis.__MenuContext??=${react}.createContext(null)).Provider,{value,children:($1)(props)});},`,
		);

		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);

// True when the open menu came from the profile (avatar) button. 1.2.94
// dropped the user-widget-link testid; the account image inside the
// trigger button is the durable discriminator, with the old testid kept
// as a fallback for older clients.
export const openedFromProfileMenu = (ctx: Pick<MenuContext, "trigger" | "target"> | null): boolean => {
	if (!ctx || ctx.trigger !== "click") return false;
	const button = ctx.target?.closest?.("button");
	if (!button) return false;
	return !!button.querySelector("img, figure") || button.getAttribute("data-testid") === "user-widget-link";
};

export const createProfileMenuShouldAdd = () => (ctx: MenuContext) => openedFromProfileMenu(ctx);

// Foreign menu items have no access to the client's dismissal context;
// the tippy portal only closes on an outside press. Call after handling
// a click. Deferred so the item's own handler finishes first.
export const closeMenu = (): void => {
	setTimeout(() => {
		document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	}, 0);
};

// Transform-free path: every context menu renders inside the #context-menu
// tippy portal; registered items are appended to the menu list when one
// opens. useMenuItem() carries the trigger and target captured from the
// opening event — the menu component's own props are not reachable from
// outside the client render pipeline and stay null.
if (
	!(globalThis as never as Record<string, unknown>).__SPICETIFY_APPLY_TRANSFORMS__ &&
	typeof document !== "undefined"
) {
	void CHUNKS.xpui.promise.then(async () => {
		const { ReactDOM } = await import("../expose/React.js");
		const { createItemBoundary } = await import("./mount.js");
		const R = React as any;
		const createRoot = (ReactDOM as any).createRoot;
		if (typeof createRoot !== "function") {
			warn("[stdlib] cannot mount menu items (no createRoot)");
			return;
		}

		let last: Omit<MenuContext, "props"> = { trigger: "", target: document.body } as never;
		document.addEventListener(
			"contextmenu",
			(e) => {
				last = { trigger: "right-click", target: e.target as HTMLElement };
			},
			true,
		);
		document.addEventListener(
			"mousedown",
			(e) => {
				last = { trigger: "click", target: e.target as HTMLElement };
			},
			true,
		);

		const ItemBoundary = createItemBoundary(R, "menu");
		const live: Array<{ menu: Element; root: { unmount: () => void } }> = [];
		const processed = new WeakSet<Element>();

		const sweep = () => {
			for (let i = live.length - 1; i >= 0; i--) {
				if (!live[i].menu.isConnected) {
					live[i].root.unmount();
					live.splice(i, 1);
				}
			}
			if (items.size === 0) return;
			for (const menu of document.querySelectorAll("#context-menu [role=menu]")) {
				if (processed.has(menu)) continue;
				processed.add(menu);
				const host = document.createElement("li");
				host.setAttribute("role", "presentation");
				host.className = "spicetify-menu-items";
				menu.appendChild(host);
				const root = createRoot(host);
				globalThis.__MenuContext ??= R.createContext(null);
				root.render(
					R.createElement(
						globalThis.__MenuContext.Provider,
						{ value: { props: null, ...last } },
						...items.all().map((item, i) => R.createElement(ItemBoundary, { key: i }, item)),
					),
				);
				live.push({ menu, root });
			}
		};
		new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
	});
}
