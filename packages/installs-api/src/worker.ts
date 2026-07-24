/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Cloudflare Worker adapter for the installs API. All protocol logic
 * lives in logic.ts; this file binds D1, WebCrypto, and fetch.
 *
 * Bindings (wrangler.toml):
 *   DB          D1 database (schema.sql)
 *   HMAC_SECRET secret used to hash Spotify account ids
 *   VAULT_URL   catalog used as the module allowlist
 */

import { handle, type Deps } from "./logic.ts";

// Minimal D1 surface; avoids a workers-types dependency.
interface D1Result {
	results?: Array<Record<string, unknown>>;
	meta?: { changes?: number };
}
interface D1Database {
	prepare(sql: string): {
		bind(...values: unknown[]): {
			run(): Promise<D1Result>;
			all(): Promise<D1Result>;
			first<T = Record<string, unknown>>(): Promise<T | null>;
		};
	};
}

interface Env {
	DB: D1Database;
	HMAC_SECRET: string;
	VAULT_URL: string;
}

// Per-isolate caches; Cloudflare recycles isolates, so these are
// best-effort accelerators, not correctness dependencies.
const tokenCache = new Map<string, { accountId: string | null; until: number }>();

let vaultCache: { modules: Set<string>; until: number } | null = null;

async function verifySpotifyToken(token: string): Promise<string | null | "throttled"> {
	const cached = tokenCache.get(token);
	if (cached && cached.until > Date.now()) return cached.accountId;
	let accountId: string | null = null;
	try {
		const res = await fetch("https://api.spotify.com/v1/me", {
			headers: { authorization: `Bearer ${token}` },
		});
		// A throttled identity check is transient: do not cache it and do
		// not treat the token as bad.
		if (res.status === 429) return "throttled";
		if (res.ok) {
			const me = (await res.json()) as { id?: string };
			accountId = typeof me.id === "string" && me.id ? me.id : null;
		}
	} catch {
		return "throttled";
	}
	// Cap the cache so a revoked token stops counting quickly.
	tokenCache.set(token, { accountId, until: Date.now() + 5 * 60_000 });
	if (tokenCache.size > 5000) tokenCache.clear();
	return accountId;
}

async function knownModules(vaultUrl: string): Promise<Set<string>> {
	if (vaultCache && vaultCache.until > Date.now()) return vaultCache.modules;
	try {
		const res = await fetch(vaultUrl, { headers: { accept: "application/json" } });
		if (res.ok) {
			const vault = (await res.json()) as { modules?: Record<string, unknown> };
			vaultCache = { modules: new Set(Object.keys(vault.modules ?? {})), until: Date.now() + 10 * 60_000 };
			return vaultCache.modules;
		}
	} catch {}
	// Vault unreachable: keep serving the stale allowlist rather than
	// dropping installs on the floor.
	return vaultCache?.modules ?? new Set();
}

async function hmacHex(secret: string, value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeDeps(env: Env): Deps {
	return {
		verifyToken: verifySpotifyToken,
		hashUser: (accountId) => hmacHex(env.HMAC_SECRET, accountId),
		isKnownModule: async (module) => (await knownModules(env.VAULT_URL)).has(module),
		recordInstall: async (module, userHash, version, now) => {
			const result = await env.DB
				.prepare(
					"INSERT INTO installs (module, user_hash, first_version, first_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (module, user_hash) DO NOTHING",
				)
				.bind(module, userHash, version, now)
				.run();
			return (result.meta?.changes ?? 0) > 0;
		},
		counts: async (modules) => {
			const placeholders = modules.map((_, i) => `?${i + 1}`).join(",");
			const result = await env.DB
				.prepare(`SELECT module, COUNT(*) AS n FROM installs WHERE module IN (${placeholders}) GROUP BY module`)
				.bind(...modules)
				.all();
			const out: Record<string, number> = {};
			for (const row of result.results ?? []) out[row.module as string] = Number(row.n);
			return out;
		},
		allow: async (bucket, limit, windowSeconds, now) => {
			// One row per bucket; the window resets lazily on expiry.
			const row = await env.DB
				.prepare(
					`INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?1, 1, ?2)
					 ON CONFLICT (bucket) DO UPDATE SET
					   count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
					   reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
					 RETURNING count`,
				)
				.bind(bucket, now + windowSeconds * 1000, now)
				.first<{ count: number }>();
			return (row?.count ?? 1) <= limit;
		},
		now: () => Date.now(),
	};
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		let body: unknown;
		if (request.method === "POST") {
			try {
				body = await request.json();
			} catch {
				body = undefined;
			}
		}
		const res = await handle(
			{
				method: request.method,
				path: url.pathname,
				query: url.searchParams,
				headers: request.headers,
				body,
				ip: request.headers.get("cf-connecting-ip") ?? "unknown",
			},
			makeDeps(env),
		);
		return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
			status: res.status,
			headers: { "content-type": "application/json", ...res.headers },
		});
	},
};
