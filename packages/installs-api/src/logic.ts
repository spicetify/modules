/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * installs-api - unique-install counting for the module store.
 *
 * Ranking signal design: a counted install requires a REAL Spotify
 * account. The client sends its Spotify access token; the server
 * verifies it against api.spotify.com/v1/me, derives an HMAC of the
 * account id with a server secret, and stores only that hash. Inflating
 * a module's count therefore costs one real Spotify account per unit,
 * and repeat installs by the same account are idempotent.
 *
 * Privacy: the raw account id is never stored and the token is used for
 * exactly one upstream identity call (and a short verification cache);
 * IPs only exist inside transient rate-limit buckets.
 *
 * Abuse layers, in order: token verification (identity), vault
 * allowlist (only cataloged modules count), per-IP and per-account rate
 * limits (velocity).
 *
 * This file is runtime-agnostic: everything effectful is injected, so
 * the whole protocol is unit-testable in Node. worker.ts adapts it to
 * Cloudflare (D1 + WebCrypto + fetch).
 */

export interface Deps {
	// Resolve a Spotify access token to a stable account id; null when the
	// token is invalid/expired, "throttled" when Spotify rate-limited the
	// identity call (the caller should retry, not be rejected).
	// Implementations should cache successes.
	verifyToken(token: string): Promise<string | null | "throttled">;
	// HMAC the account id with the server secret.
	hashUser(accountId: string): Promise<string>;
	// True when the module exists in the vault catalog.
	isKnownModule(module: string): Promise<boolean>;
	// Record (module, userHash); returns true when this pair is new.
	recordInstall(module: string, userHash: string, version: string, now: number): Promise<boolean>;
	// Unique-install counts for the requested modules.
	counts(modules: string[]): Promise<Record<string, number>>;
	// Sliding-window rate limit; returns true when the call is allowed.
	allow(bucket: string, limit: number, windowSeconds: number, now: number): Promise<boolean>;
	now(): number;
}

const MODULE_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]{0,40})?$/;
const MAX_COUNT_QUERY = 100;

// Velocity caps: an IP may submit a burst of installs (fresh machine
// applying a profile), but sustained spam trips either bucket. Reads get
// their own generous gate so the endpoint cannot be used for unbounded
// D1 read amplification.
const IP_LIMIT = { limit: 30, windowSeconds: 600 };
const USER_LIMIT = { limit: 40, windowSeconds: 86_400 };
const READ_LIMIT = { limit: 120, windowSeconds: 600 };

const CORS_ORIGINS = new Set(["https://xpui.app.spotify.com"]);

export interface ApiRequest {
	method: string;
	path: string;
	query: URLSearchParams;
	headers: { get(name: string): string | null };
	body?: unknown;
	ip: string;
}

export interface ApiResponse {
	status: number;
	body: Record<string, unknown>;
	headers: Record<string, string>;
}

function corsHeaders(origin: string | null): Record<string, string> {
	const allowed = origin && CORS_ORIGINS.has(origin) ? origin : "https://xpui.app.spotify.com";
	return {
		"access-control-allow-origin": allowed,
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type",
		"access-control-max-age": "86400",
	};
}

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): ApiResponse => ({
	status,
	body,
	headers,
});

export async function handle(req: ApiRequest, deps: Deps): Promise<ApiResponse> {
	const cors = corsHeaders(req.headers.get("origin"));
	if (req.method === "OPTIONS") return json(204, {}, cors);

	if (req.method === "GET" && req.path === "/v1/installs") {
		if (!(await deps.allow(`read:${req.ip}`, READ_LIMIT.limit, READ_LIMIT.windowSeconds, deps.now()))) {
			return json(429, { error: "rate limited" }, cors);
		}
		const raw = req.query.get("modules") ?? "";
		const modules = [
			...new Set(
				raw
					.split(",")
					.map((m) => m.trim())
					.filter((m) => MODULE_RE.test(m)),
			),
		];
		if (!modules.length) return json(400, { error: "modules query required" }, cors);
		if (modules.length > MAX_COUNT_QUERY) return json(400, { error: `at most ${MAX_COUNT_QUERY} modules` }, cors);
		const counts = await deps.counts(modules);
		// Absent modules count as zero so clients need no special casing.
		for (const m of modules) counts[m] ??= 0;
		return json(200, { counts }, { ...cors, "cache-control": "public, max-age=300" });
	}

	if (req.method === "POST" && req.path === "/v1/installs") {
		const now = deps.now();
		// Free validation first: malformed or unauthenticated requests must
		// not cost a rate-limit write.
		const body = req.body as { module?: unknown; version?: unknown } | undefined;
		const module = typeof body?.module === "string" ? body.module : "";
		const version = typeof body?.version === "string" ? body.version : "";
		if (!MODULE_RE.test(module)) return json(400, { error: "invalid module" }, cors);
		if (!VERSION_RE.test(version)) return json(400, { error: "invalid version" }, cors);

		const auth = req.headers.get("authorization") ?? "";
		const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
		if (!token) return json(401, { error: "missing bearer token" }, cors);

		if (!(await deps.allow(`ip:${req.ip}`, IP_LIMIT.limit, IP_LIMIT.windowSeconds, now))) {
			return json(429, { error: "rate limited" }, cors);
		}
		const accountId = await deps.verifyToken(token);
		// Spotify throttles the identity endpoint; that is not the caller's
		// fault and must not read as an invalid token.
		if (accountId === "throttled") {
			return json(503, { error: "identity check throttled, retry later" }, { ...cors, "retry-after": "60" });
		}
		if (!accountId) return json(401, { error: "token rejected" }, cors);

		if (!(await deps.isKnownModule(module))) return json(404, { error: "unknown module" }, cors);

		const userHash = await deps.hashUser(accountId);
		if (!(await deps.allow(`user:${userHash}`, USER_LIMIT.limit, USER_LIMIT.windowSeconds, now))) {
			return json(429, { error: "rate limited" }, cors);
		}

		const counted = await deps.recordInstall(module, userHash, version, now);
		return json(200, { counted }, cors);
	}

	return json(404, { error: "not found" }, cors);
}
