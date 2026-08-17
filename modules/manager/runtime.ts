/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Manager's recovery-tier adapter. Keep wrapper-global access in this one
// file so both the React page and plain-DOM fallback can inspect/repair a
// client whose stdlib capture is unhealthy.
export const managerRuntime = () => globalThis as never as Record<string, any>;
export const managerModules = () => managerRuntime().Spicetify?.Modules;
export const managerSpotifyVersion = () => managerRuntime().Spicetify?.Platform?.version as string | undefined;
