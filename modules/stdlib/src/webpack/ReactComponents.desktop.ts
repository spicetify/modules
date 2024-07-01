/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { analyzeWebpackRequire, require } from "./index.ts";

await (CHUNKS["/xpui-desktop-routes-settings.js"] ??= Promise.withResolvers()).promise;

const { modules } = analyzeWebpackRequire(require);
export const Settings: {
	SettingsLabel: React.FC<{}>;
	SettingsRow: React.FC<{}>;
	SettingsRowEnd: React.FC<{}>;
	SettingsRowStart: React.FC<{}>;
} = modules.find((m) => m.SettingsRow);
