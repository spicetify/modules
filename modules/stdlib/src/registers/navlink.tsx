/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { findMatchingPos } from "/hooks/util.ts";
import { createIconComponent } from "../../lib/createIconComponent.tsx";
import { transformer } from "../../mixin.ts";
import { Platform } from "../expose/Platform.ts";
import { classnames } from "../webpack/ClassNames.ts";
import { Nav, ScrollableContainer, Tooltip } from "../webpack/ReactComponents.ts";
import { UI } from "../webpack/ComponentLibrary.ts";
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

export type NavLinkProps = {
	localizedApp: string;
	appRoutePath: string;
	icon: string;
	activeIcon: string;
};
export const NavLink: React.FC<NavLinkProps> = (props) => {
	const isActive = Platform.getHistory().location.pathname?.startsWith(props.appRoutePath);
	const createIcon = () =>
		createIconComponent({ icon: isActive ? props.activeIcon : props.icon, iconSize: 24 });

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
						"M4MOhDLjSPUuMog9WxIM", // next to navigation
						"dIfr5oVr5kotAi0HsIsW VUXMMFKWudUWE1kIXZoS",
						{
							ETjtwGvAB4lRVqSzm8nA: props.isActive,
						},
					)}
					aria-label={props.localizedApp}
					onClick={() => Platform.getHistory().push(props.appRoutePath)}
				/>
			</Tooltip>
		</div>
	);
};
