/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { webpackRequire } from "../wpunpk.mix.ts";
import { matchWebpackModule } from "../wpunpk.ts";

export * from "./ReactComponents.gen.ts";

export let Slider: React.FC<any>;
export let Toggle: React.FC<any>;
export let TracklistRow: React.FC<any>;

// postWebpackRequireHooks.push($ => {
matchWebpackModule((id, module) => {
	const moduleStr = module.toString();
	return moduleStr.includes('"data-testid":"progress-bar"');
}, (id, $) => {
	const module = webpackRequire(id);
	Slider = Object.values(module)[0];
});

matchWebpackModule((id, module) => {
	const moduleStr = module.toString();
	return moduleStr.includes('"JWYoNAyrIIdW30u4PSGE"');
}, (id, $) => {
	const module = webpackRequire(id);
	Toggle = Object.values(module)[0];
});

matchWebpackModule((id, module) => {
	const moduleStr = module.toString();
	return moduleStr.includes('"data-testid":"track-icon"');
}, async (id, $) => {
	//! HACKY ALERT (this module depennds on chunks that aren't loaded yet)
	await new Promise(setTimeout);
	const module = webpackRequire(id);
	TracklistRow = Object.values(module)[0];
});
// })
