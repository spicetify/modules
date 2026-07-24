/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { analyzeWebpackRequire } from "./index.ts";
import { webpackRequire } from "../wpunpk.mix.ts";

await (CHUNKS["/xpui-desktop-routes-settings.js"] ??= Promise.withResolvers()).promise;

const { exports } = analyzeWebpackRequire(webpackRequire);
export const Settings: {
	SettingsLabel: React.FC<any>;
	SettingsRow: React.FC<any>;
	SettingsRowEnd: React.FC<any>;
	SettingsRowStart: React.FC<any>;
} = exports.find((m) => m.SettingsRow) as any;
