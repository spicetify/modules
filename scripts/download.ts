/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Capped download for artifact URLs that come out of a submission.
 *
 * The URL is attacker-supplied, so the cap has to bound what is read rather
 * than what was read: buffering the whole response and measuring it
 * afterwards exhausts the runner before the check is ever reached. The body
 * is streamed and abandoned the moment it goes over.
 */

const TIMEOUT_MS = 120_000;

export async function downloadCapped(url: string, maxBytes: number): Promise<Buffer> {
	const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);

	// A declared length over the cap is refused before a byte is read; it is
	// a hint, not a promise, so the streamed count is still enforced below.
	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new Error(`${url} declares ${declared} bytes, over the ${maxBytes} byte cap`);
	}
	if (!res.body) throw new Error(`${url} returned no body`);

	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
		total += chunk.byteLength;
		if (total > maxBytes) {
			await res.body.cancel().catch(() => {});
			throw new Error(`${url} is over the ${maxBytes} byte cap`);
		}
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}
