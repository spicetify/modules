/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ModuleInstance } from "/hooks/module.ts";

import menu from "./menu.ts";
import navlink from "./navlink.tsx";
import panel from "./panel.ts";
import playbarButton from "./playbarButton.tsx";
import playbarWidget from "./playbarWidget.tsx";
import { Registry } from "./registry.ts";
import root from "./root.ts";
import route from "./route.ts";
import settingsSection from "./settingsSection.ts";
import topbarLeftButton from "./topbarLeftButton.tsx";
import topbarRightButton from "./topbarRightButton.tsx";
const [rootChild, rootProvider] = root;
const registers = {
	menu,
	navlink,
	panel,
	playbarButton,
	playbarWidget,
	rootChild,
	rootProvider,
	route,
	settingsSection,
	topbarLeftButton,
	topbarRightButton,
} satisfies Record<string, Registry<any>>;
type Registers = typeof registers;

export class Registrar {
	constructor(public id: string) {}

	private ledger = new Map<any, keyof Registers>();

	register<R extends keyof Registers>(type: R, ...args: Parameters<Registers[R]["add"]>) {
		this.ledger.set(args[0], type);
		// @ts-ignore
		registers[type].add(...args);
	}

	unregister<R extends keyof Registers>(type: R, ...args: Parameters<Registers[R]["delete"]>) {
		this.ledger.delete(args[0]);
		// @ts-ignore
		registers[type].delete(...args);
	}

	dispose() {
		for (const [item, type] of this.ledger.entries()) this.unregister(type, item);
		this.ledger.clear();
	}
}

export const createRegistrar = (mod: ModuleInstance) => {
	const registrar = new Registrar(mod.getModuleIdentifier());
	mod._jsIndex!.disposableStack.defer(() => {
		registrar.dispose();
	});
	return registrar;
};
