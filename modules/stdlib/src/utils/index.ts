/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Platform } from "../expose/Platform.ts";

export const isGlobalNavBarEnabled = () => {
	if (!Platform) {
		return undefined;
	}
	const { enableGlobalNavBar } = Platform.getLocalStorageAPI().getItem("remote-config-overrides");
	return (
		enableGlobalNavBar === "home-next-to-navigation" || enableGlobalNavBar === "home-next-to-search"
	);
};
