/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ClientCapabilities } from "/modules/stdlib/src/client.ts";

type LyricsClient = Pick<ClientCapabilities, "cosmos">;

let configuredClient: LyricsClient | undefined;

export function configureLyricsClient(client: LyricsClient): void {
	configuredClient = client;
}

export const lyricsClient: LyricsClient = {
	get cosmos() {
		if (!configuredClient) throw new Error("Lyrics Plus client is not configured");
		return configuredClient.cosmos;
	},
};
