/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { findMatchingPos } from "/hooks/util.ts";
import { createIconComponent } from "../createIconComponent.tsx";
import { transformer } from "../../mixin.ts";
import { Platform } from "../expose/Platform.ts";
import { warn } from "../logger.ts";
import { classnames } from "../webpack/ClassNames.ts";
import { Nav, ScrollableContainer, Tooltip } from "../webpack/ReactComponents.ts";
import { UI } from "../webpack/ComponentLibrary.ts";
import { mountRegistryAnchor } from "./mount.ts";
import { Registry } from "./registry.ts";

const registry = new (class extends Registry<React.ReactNode> {
	override add(value: React.ReactNode): this {
		refresh?.();
		return super.add(value);
	}

	override delete(value: React.ReactNode): boolean {
		refresh?.();
		return super.delete(value);
	}
})();
export default registry;

let refresh: React.DispatchWithoutAction | undefined;

declare global {
	var __renderNavLinks: () => React.ReactNode;
}

globalThis.__renderNavLinks = () =>
	React.createElement(() => {
		[, refresh] = React.useReducer((n) => n + 1, 0);

		if (!ScrollableContainer) {
			return;
		}

		return (
			<ScrollableContainer className="custom-navlinks-scrollable_container" onlyHorizontalWheel>
				{registry.all()}
			</ScrollableContainer>
		);
	});
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(
			/{(?=[^{}]*(?:{[^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*}[^{}]*)*(?<=[,{])"data-testid":"global-nav-bar")([^{}]*(?:{[^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*}[^{}]*)*(?<=[,{]))children:([^{}]*(?:{[^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*}[^{}]*)*)(,[^{}]*(?:{[^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*}[^{}]*)*|)}/,
			"{$1children:(function(children){const p=children[0].props;p.children=[p.children,__renderNavLinks()].flat();return children})($2)$3}",
		);

		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace('["","/","/home/",', '["","/","/home/","/bespoke/*",');

		return str;
	},
	{
		glob: /^\/dwp\-top\-bar\.js/,
	},
);

mountRegistryAnchor({
	className: "spicetify-navlinks-anchor",
	registry,
	setRefresh: (cb) => {
		refresh = cb;
	},
	findSlot: () => {
		const wrapper = document.querySelector(".main-globalNav-historyButtonsWrapper");
		return wrapper ? { parent: wrapper } : null;
	},
	// A real flex box, not the default display:contents. The history-buttons
	// wrapper spaces its children with a wide gap meant to separate button
	// groups; as one box the anchor takes that gap once (separating our links
	// from the back/forward group), while the nav links inside space
	// themselves with the client's own 8px navlink margins.
	hostDisplay: "flex",
});

// Registered elements are frozen in the registry, so parent refreshes
// bail out on identical children; any registered component that renders
// route-dependent state must subscribe to history itself.
export const useHistoryRefresh = (): void => {
	const [, force] = React.useReducer((n: number) => n + 1, 0);
	React.useEffect(() => {
		try {
			return Platform.getHistory().listen(() => force()) as (() => void) | undefined;
		} catch (e) {
			warn("[stdlib] cannot follow history:", e);
			return undefined;
		}
	}, []);
};

export type NavLinkProps = {
	localizedApp: string;
	appRoutePath: string;
	/** Inner SVG markup drawn on the stdlib 16-grid (upscaled to the client's 24px nav glyph). */
	icon: string;
	/** Filled variant shown while the route is active; same 16-grid contract. */
	activeIcon: string;
};
export const NavLink: React.FC<NavLinkProps> = (props) => {
	useHistoryRefresh();
	const isActive = Platform.getHistory().location.pathname?.startsWith(props.appRoutePath);
	const createIcon = () =>
		// Icons are authored on the stdlib 16-grid; upscale to the client's
		// 24px nav glyph size so they fill the circle like Home's.
		createIconComponent({ icon: isActive ? props.activeIcon : props.icon, iconSize: 16, realIconSize: 24 });

	return (
		<_NavLinkGlobal
			localizedApp={props.localizedApp}
			appRoutePath={props.appRoutePath}
			createIcon={createIcon}
			isActive={isActive}
		/>
	);
};

interface NavLinkFactoryProps {
	localizedApp: string;
	appRoutePath: string;
	createIcon: () => React.ReactNode;
	isActive: boolean;
}

const _NavLinkGlobal: React.FC<NavLinkFactoryProps> = (props) => {
	return (
		<div className="inline-flex">
			<Tooltip label={props.localizedApp}>
				<UI.ButtonTertiary
					iconOnly={props.createIcon}
					className={classnames(
						// The circular chrome the client paints on its own nav links
						// (Home); without it the button renders bare on the bar.
						"main-globalNav-navLink",
						"main-globalNav-link-icon link-subtle",
						{
							"main-globalNav-navLinkActive": props.isActive,
						},
					)}
					aria-label={props.localizedApp}
					onClick={() => Platform.getHistory().push(props.appRoutePath)}
				/>
			</Tooltip>
		</div>
	);
};
