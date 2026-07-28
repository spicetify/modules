/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { startEventHandlers } from "./src/events.js";
import { installPlaybarCompat } from "./src/playbar-compat.js";

export default async function (_ctx: { spotifyVersion: string }) {
	const cancelEventHandlers = startEventHandlers();
	const uninstallPlaybarCompat = installPlaybarCompat();
	return () => {
		uninstallPlaybarCompat();
		cancelEventHandlers();
	};
}
