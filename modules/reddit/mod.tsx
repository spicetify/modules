/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar, NavLink, React, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { Button, Chip, IconButton, Select, TextInput } from "/modules/stdlib/lib/primitives.js";
import { RedditCard } from "./components.tsx";
import { FeedError, fetchRedditItems } from "./data.ts";
import {
	MAX_SUBREDDITS,
	SORTS,
	TIMES,
	isTimeAware,
	normalizeSubreddit,
	readSubreddits,
	validateCache,
	type CacheShape,
	type RedditItem,
	type Sort,
	type Time,
} from "./logic.ts";

const ROUTE = "/bespoke/reddit";
const ICON =
	'<path fill="currentColor" d="M13.7 8a2 2 0 0 0-1.2-1.8c-.8-.4-1.7-.6-2.6-.7l.5-2.1 1.5.3a1.4 1.4 0 1 0 .2-.8l-2-.4a.4.4 0 0 0-.5.3L9 5.4a9 9 0 0 0-3.5.7A2 2 0 0 0 2.3 8a2 2 0 0 0 .7 1.5v.4c0 2.5 2.2 4.5 5 4.5s5-2 5-4.5v-.4a2 2 0 0 0 .7-1.5ZM5.5 9.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm5 3.1c-.7.7-1.5 1-2.5 1s-1.8-.3-2.5-1a.4.4 0 0 1 .6-.6c.5.5 1.2.8 1.9.8s1.4-.3 1.9-.8a.4.4 0 0 1 .6.6Zm0-1.1a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>';
const CACHE_VERSION = 1;
const TTL_MS = 15 * 60 * 1000;
const CACHE_PREFIX = "reddit:cache:";
const MAX_CACHE_KEYS = 24;

const read = (key: string): string | null => globalThis.localStorage?.getItem(`reddit:${key}`) ?? null;
const write = (key: string, value: string): void => globalThis.localStorage?.setItem(`reddit:${key}`, value);
const cacheKey = (subreddit: string, sort: Sort, time: Time) => `cache:${subreddit.toLowerCase()}:${sort}:${time}`;
const readCache = (key: string): CacheShape | null => {
	try {
		return validateCache(JSON.parse(read(key) ?? "null"), CACHE_VERSION);
	} catch {
		return null;
	}
};
// 24 subreddits by 15 sort/time combinations is enough distinct keys to
// crowd the origin quota the module loader also lives in, so every write
// prunes: expired entries go, and the newest MAX_CACHE_KEYS stay.
const pruneCache = (): void => {
	const ls = globalThis.localStorage;
	if (!ls) return;
	const entries: Array<{ key: string; fetchedAt: number }> = [];
	for (let i = 0; i < ls.length; i++) {
		const key = ls.key(i);
		if (!key?.startsWith(CACHE_PREFIX)) continue;
		let fetchedAt = 0;
		try {
			fetchedAt = Number(JSON.parse(ls.getItem(key) ?? "null")?.fetchedAt) || 0;
		} catch {
			/* an unreadable entry sorts oldest and is pruned first */
		}
		entries.push({ key, fetchedAt });
	}
	const now = Date.now();
	const keep = entries.filter((entry) => now - entry.fetchedAt <= TTL_MS).sort((a, b) => b.fetchedAt - a.fetchedAt);
	for (const entry of entries) {
		if (now - entry.fetchedAt > TTL_MS) ls.removeItem(entry.key);
	}
	for (const entry of keep.slice(MAX_CACHE_KEYS)) ls.removeItem(entry.key);
};
const writeCache = (key: string, items: RedditItem[]): void => {
	try {
		write(key, JSON.stringify({ v: CACHE_VERSION, fetchedAt: Date.now(), items }));
		pruneCache();
	} catch {
		/* localStorage quota: retain the live result without persistence */
	}
};

// Reddit rate-limits the client as a whole, not one feed, so the cooldown
// outlives the keyed page state and survives remounts.
let cooldownUntil = 0;

const SORT_OPTIONS: ReadonlyArray<{ value: Sort; label: string }> = SORTS.map((value) => ({
	value,
	label: `${value[0].toUpperCase()}${value.slice(1)}`,
}));
const TIME_OPTIONS: ReadonlyArray<{ value: Time; label: string }> = TIMES.map((value) => ({
	value,
	label: `${value[0].toUpperCase()}${value.slice(1)}`,
}));

type Phase = "loading" | "refreshing" | "idle";

const Page = () => {
	const [subreddits, setSubreddits] = React.useState(() => readSubreddits(read("services")));
	const [subreddit, setSubreddit] = React.useState(() => {
		const saved = read("last-service");
		return (saved && subreddits.find((name) => name.toLowerCase() === saved.toLowerCase())) || subreddits[0];
	});
	const [sort, setSort] = React.useState<Sort>(() => {
		const saved = read("sort-by") as Sort;
		return SORTS.includes(saved) ? saved : "top";
	});
	const [time, setTime] = React.useState<Time>(() => {
		const saved = read("sort-time") as Time;
		return TIMES.includes(saved) ? saved : "month";
	});
	const [manage, setManage] = React.useState(false);
	const [draft, setDraft] = React.useState("");
	const [refresh, setRefresh] = React.useState(0);
	const [items, setItems] = React.useState<RedditItem[]>([]);
	const [phase, setPhase] = React.useState<Phase>("loading");
	const [error, setError] = React.useState("");
	const [retryAt, setRetryAt] = React.useState<number | undefined>();
	const [now, setNow] = React.useState(Date.now());
	// Set by the two refresh buttons and consumed by exactly one effect run,
	// so a forced fetch never disables the cache for later key switches.
	const force = React.useRef(false);

	React.useEffect(() => {
		if (!retryAt || retryAt <= Date.now()) return;
		setNow(Date.now());
		const timer = setInterval(() => {
			const current = Date.now();
			setNow(current);
			if (current >= retryAt) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	}, [retryAt]);

	React.useEffect(() => {
		const key = cacheKey(subreddit, sort, time);
		const controller = new AbortController();
		const cached = readCache(key);
		setItems(cached?.items ?? []);
		setError("");
		setRetryAt(undefined);
		const stale = !cached || Date.now() - cached.fetchedAt > TTL_MS || force.current;
		force.current = false;
		if (!stale) {
			setPhase("idle");
			return () => controller.abort();
		}
		if (Date.now() < cooldownUntil) {
			setError("Reddit is rate-limiting this feed.");
			setRetryAt(cooldownUntil);
			setPhase("idle");
			return () => controller.abort();
		}
		setPhase(cached ? "refreshing" : "loading");
		void fetchRedditItems(subreddit, sort, time, controller.signal)
			.then((next) => {
				if (controller.signal.aborted) return;
				setItems(next);
				writeCache(key, next);
			})
			.catch((reason) => {
				if (controller.signal.aborted) return;
				setError(reason instanceof Error ? reason.message : "Could not load Reddit.");
				if (reason instanceof FeedError && reason.retryAt) {
					cooldownUntil = reason.retryAt;
					setRetryAt(reason.retryAt);
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) setPhase("idle");
			});
		return () => controller.abort();
	}, [subreddit, sort, time, refresh]);

	const requestRefresh = () => {
		force.current = true;
		setRefresh((value) => value + 1);
	};
	const pickSubreddit = (name: string) => {
		setSubreddit(name);
		write("last-service", name);
	};
	const changeSort = (next: Sort) => {
		setSort(next);
		write("sort-by", next);
	};
	const changeTime = (next: Time) => {
		setTime(next);
		write("sort-time", next);
	};
	const addSubreddit = () => {
		const next = normalizeSubreddit(draft);
		if (!next || subreddits.length >= MAX_SUBREDDITS) return;
		if (subreddits.some((item) => item.toLowerCase() === next.toLowerCase())) return;
		const list = [...subreddits, next];
		setSubreddits(list);
		write("services", JSON.stringify(list));
		pickSubreddit(next);
		setDraft("");
	};
	const removeSubreddit = (name: string) => {
		if (subreddits.length === 1) return;
		const list = subreddits.filter((item) => item !== name);
		setSubreddits(list);
		write("services", JSON.stringify(list));
		if (subreddit === name) pickSubreddit(list[0]);
	};
	const retrySeconds = retryAt && retryAt > now ? Math.ceil((retryAt - now) / 1000) : 0;

	return (
		<div className="reddit-v3-page">
			<header className="reddit-v3-header">
				<div>
					<h1>Reddit</h1>
					<p>Spotify links shared by music communities.</p>
				</div>
				<div className="reddit-v3-controls">
					<Select<Sort>
						ariaLabel="Sort Reddit posts"
						options={SORT_OPTIONS}
						value={sort}
						onChange={changeSort}
					/>
					{isTimeAware(sort) ? (
						<Select<Time>
							ariaLabel="Sort period"
							options={TIME_OPTIONS}
							value={time}
							onChange={changeTime}
						/>
					) : null}
					<IconButton
						ariaLabel="Refresh Reddit feed"
						disabled={phase !== "idle" || retrySeconds > 0}
						onClick={requestRefresh}
					>
						⟳
					</IconButton>
				</div>
			</header>

			<div className="reddit-v3-subreddits" role="group" aria-label="Subreddits">
				{subreddits.map((name) => (
					<Chip key={name} active={name === subreddit} onClick={() => pickSubreddit(name)}>
						r/{name}
					</Chip>
				))}
				<Button variant="secondary" onClick={() => setManage((value) => !value)}>
					{manage ? "Done" : "Manage"}
				</Button>
			</div>

			{manage ? (
				<section className="reddit-v3-manager" aria-label="Manage subreddits">
					<div className="reddit-v3-add">
						<TextInput
							ariaLabel="New subreddit"
							placeholder="Add a subreddit"
							value={draft}
							onInput={setDraft}
						/>
						<Button
							disabled={!normalizeSubreddit(draft) || subreddits.length >= MAX_SUBREDDITS}
							onClick={addSubreddit}
						>
							{subreddits.length >= MAX_SUBREDDITS ? `Limit of ${MAX_SUBREDDITS} reached` : "Add"}
						</Button>
					</div>
					<div className="reddit-v3-remove-list">
						{subreddits.map((name) => (
							<Button
								key={name}
								variant="secondary"
								disabled={subreddits.length === 1}
								onClick={() => removeSubreddit(name)}
							>
								Remove r/{name}
							</Button>
						))}
					</div>
				</section>
			) : null}

			{phase === "loading" ? (
				<p className="reddit-v3-status">Loading r/{subreddit} through the local proxy…</p>
			) : null}
			{phase === "refreshing" ? <p className="reddit-v3-status">Updating cached posts…</p> : null}
			{error ? (
				<div className="reddit-v3-error">
					<p>
						{error}
						{retrySeconds ? ` Try again in ${retrySeconds}s.` : ""}
					</p>
					<Button variant="secondary" disabled={retrySeconds > 0} onClick={requestRefresh}>
						Try again
					</Button>
				</div>
			) : null}
			{phase === "idle" && !error && items.length === 0 ? (
				<p className="reddit-v3-status">No Spotify links were found in this feed.</p>
			) : null}
			{items.length ? (
				<section className="reddit-v3-grid" aria-label={`Spotify links from r/${subreddit}`}>
					{items.map((item) => (
						<RedditCard key={item.uri} item={item} />
					))}
				</section>
			) : null}
		</div>
	);
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register("navlink", <NavLink localizedApp="Reddit" appRoutePath={ROUTE} icon={ICON} activeIcon={ICON} />);
	registrar.registerRoute(ROUTE, <Page />);
}
