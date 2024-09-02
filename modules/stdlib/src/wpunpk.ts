/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { moduleLoadedSubject, type WebpackModule, webpackRequire } from "./wpunpk.mix.ts";

type ModuleMatcher = (id: string, module: WebpackModule) => boolean;
type ModulePair = [keyof any, WebpackModule];

export function matchWebpackModuleSync(moduleMatcher: ModuleMatcher): ModulePair | null {
	if (webpackRequire) {
		for (const [id, module] of Object.entries(webpackRequire!.m)) {
			if (moduleMatcher(id, module)) {
				return [id, module] as ModulePair;
			}
		}
	}

	return null;
}

export function matchWebpackModule(
	moduleMatcher: ModuleMatcher,
	callback: (...args: ModulePair) => void,
) {
	const sync = matchWebpackModuleSync(moduleMatcher);
	if (sync) {
		callback(...sync);
		return;
	}

	const subscription = moduleLoadedSubject.subscribe(([id, module]) => {
		if (moduleMatcher(id, module)) {
			subscription.unsubscribe();
			callback(id, module);
		}
	});
}
