/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";

import { matchLast } from "/hooks/util.ts";

import { transformer } from "../../mix.ts";
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
		str = str.replace(
			/("Menu".+?children:)([a-zA-Z_\$][\w\$]*)/,
			"$1[__renderMenuItems(),$2].flat()",
		);

		const croppedInput = str.match(/.*value:"contextmenu"/)![0];
		const react = matchLast(croppedInput, /([a-zA-Z_\$][\w\$]*)\.useRef/g)[1];

		const menu = matchLast(croppedInput, /menu:([a-zA-Z_\$][\w\$]*)/g)?.[1];
		const trigger = matchLast(croppedInput, /trigger:([a-zA-Z_\$][\w\$]*)/g)?.[1];
		const target = matchLast(croppedInput, /triggerRef:([a-zA-Z_\$][\w\$]*)/g)?.[1];

		let value: string;
		if (menu && trigger && target) {
			value = `{props:${menu}.props,trigger:${trigger},target:${target}}`;
		} else {
			value = `{props:e.menu?.props,trigger:e.trigger,target:e.triggerRef}`;
		}


		str = str.replace(
			/render:(.{0,100}?\(0,([a-zA-Z_\$][\w\$]*)\.jsx\)\([a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*,\{value:"contextmenu",[^\}]+\}[^,]+),/,
			`render:(props)=>{const value=${value};return ($2.jsx)((globalThis.__MenuContext??=${react}.createContext(null)).Provider,{value,children:$2.jsx($1,props)});},`,
		);

		emit();
		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);

export const createProfileMenuShouldAdd = () => ({ trigger, target }: MenuContext) =>
	trigger === "click" && target.getAttribute("data-testid") === "user-widget-link";
