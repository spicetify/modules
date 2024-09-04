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
	var __renderNavLinks: any;
}

let navLinkFactoryCtx: React.Context<React.FC<NavLinkFactoryProps>>;
globalThis.__renderNavLinks = (isGlobalNavBar: boolean) =>
	React.createElement(() => {
		[, refresh] = React.useReducer((n) => n + 1, 0);

		if (!ScrollableContainer) {
			return;
		}

		const navLinkFactory = isGlobalNavBar ? _NavLinkGlobal : _NavLinkSidebar;

		if (!navLinkFactoryCtx) {
			navLinkFactoryCtx = React.createContext<React.FC<NavLinkFactoryProps>>(null!);
		}

		const children = (
			<navLinkFactoryCtx.Provider value={navLinkFactory}>
				{registry.all()}
			</navLinkFactoryCtx.Provider>
		);

		return isGlobalNavBar
			? (
				<ScrollableContainer className="custom-navlinks-scrollable_container" onlyHorizontalWheel>
					{children}
				</ScrollableContainer>
			)
			: children;
	});
transformer(
	(emit) => (str) => {
		emit();

		const j = str.search(/\("li",\{[^\{]*\{[^\{]*\{to:"\/search/);
		const i = findMatchingPos(str, j, 1, ["(", ")"], 1);

		str = `${str.slice(0, i)},__renderNavLinks(false)${str.slice(i)}`;

		str = str.replace(
			/(,[a-zA-Z_\$][\w\$]*===(?:[a-zA-Z_\$][\w\$]*\.){2}HOME_NEXT_TO_NAVIGATION&&.+?)\]/,
			"$1,__renderNavLinks(true)]",
		);

		str = str.replace(/(\["\/","\/home\/")/, '$1,"/bespoke/*"');

		return str;
	},
	{
		glob: /^\/xpui\.js/,
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

	const NavLinkFactory = React.useContext(navLinkFactoryCtx);

	return (
		NavLinkFactory && (
			<NavLinkFactory
				localizedApp={props.localizedApp}
				appRoutePath={props.appRoutePath}
				createIcon={createIcon}
				isActive={isActive}
			/>
		)
	);
};

interface NavLinkFactoryProps {
	localizedApp: string;
	appRoutePath: string;
	createIcon: () => React.ReactNode;
	isActive: boolean;
}

const _NavLinkSidebar: React.FC<NavLinkFactoryProps> = (props) => {
	const isSidebarCollapsed = Platform.getLocalStorageAPI().getItem("ylx-sidebar-state") === 1;

	return (
		<li className={`${MAP.main.navbar.link.wrapper} InvalidDropTarge`}>
			<Tooltip
				label={isSidebarCollapsed ? props.localizedApp : null}
				disabled={!isSidebarCollapsed}
				placement="right"
			>
				<Nav
					to={props.appRoutePath}
					referrer="other"
					className={classnames("link-subtle", MAP.main.navbar.link.container, {
						[MAP.main.navbar.link.container__active]: props.isActive,
					})}
					onClick={() => undefined}
					aria-label={props.localizedApp}
				>
					{props.createIcon()}
					{!isSidebarCollapsed && <UI.Text variant="bodyMediumBold">{props.localizedApp}</UI.Text>}
				</Nav>
			</Tooltip>
		</li>
	);
};

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
