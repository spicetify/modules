/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar, NavLink, React, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { Button, Chip, IconButton, Select, TextInput } from "/modules/stdlib/lib/primitives.js";
import { RedditCard } from "./components.tsx";
import { FeedError, fetchRedditItems } from "./data.ts";
import {
	SORTS,
	TIMES,
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
const writeCache = (key: string, items: RedditItem[]): void => {
	try {
		write(key, JSON.stringify({ v: CACHE_VERSION, fetchedAt: Date.now(), items }));
	} catch {
		/* localStorage quota: retain the live result without persistence */
	}
};

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
		return saved && readSubreddits(read("services")).includes(saved) ? saved : readSubreddits(read("services"))[0];
	});
	const [sort, setSort] = React.useState<Sort>(() =>
		SORTS.includes(read("sort-by") as Sort) ? (read("sort-by") as Sort) : "top",
	);
	const [time, setTime] = React.useState<Time>(() =>
		TIMES.includes(read("sort-time") as Time) ? (read("sort-time") as Time) : "month",
	);
	const [manage, setManage] = React.useState(false);
	const [draft, setDraft] = React.useState("");
	const [refresh, setRefresh] = React.useState(0);
	const [items, setItems] = React.useState<RedditItem[]>([]);
	const [phase, setPhase] = React.useState<Phase>("loading");
	const [error, setError] = React.useState("");
	const [retryAt, setRetryAt] = React.useState<number | undefined>();
	const [now, setNow] = React.useState(Date.now());

	const key = cacheKey(subreddit, sort, time);
	React.useEffect(() => {
		if (!retryAt) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [retryAt]);

	React.useEffect(() => {
		write("services", JSON.stringify(subreddits));
		write("last-service", subreddit);
		write("sort-by", sort);
		write("sort-time", time);
	}, [subreddits, subreddit, sort, time]);

	React.useEffect(() => {
		const controller = new AbortController();
		const cached = readCache(key);
		setItems(cached?.items ?? []);
		setError("");
		setRetryAt(undefined);
		const stale = !cached || Date.now() - cached.fetchedAt > TTL_MS || refresh > 0;
		if (!stale) {
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
				if (reason instanceof FeedError) setRetryAt(reason.retryAt);
			})
			.finally(() => {
				if (!controller.signal.aborted) setPhase("idle");
			});
		return () => controller.abort();
	}, [key, refresh]);

	const addSubreddit = () => {
		const next = normalizeSubreddit(draft);
		if (!next || subreddits.some((item) => item.toLowerCase() === next.toLowerCase())) return;
		setSubreddits((current) => [...current, next]);
		setSubreddit(next);
		setDraft("");
	};
	const removeSubreddit = (name: string) => {
		if (subreddits.length === 1) return;
		const next = subreddits.filter((item) => item !== name);
		setSubreddits(next);
		if (subreddit === name) setSubreddit(next[0]);
	};
	const retrySeconds = retryAt && retryAt > now ? Math.ceil((retryAt - now) / 1000) : 0;

	return (
		<main className="reddit-v3-page">
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
						onChange={setSort}
					/>
					{sort === "top" || sort === "controversial" ? (
						<Select<Time> ariaLabel="Sort period" options={TIME_OPTIONS} value={time} onChange={setTime} />
					) : null}
					<IconButton
						ariaLabel="Refresh Reddit feed"
						disabled={phase !== "idle" || retrySeconds > 0}
						onClick={() => setRefresh((value) => value + 1)}
					>
						⟳
					</IconButton>
				</div>
			</header>

			<nav className="reddit-v3-subreddits" aria-label="subreddits">
				{subreddits.map((name) => (
					<Chip key={name} active={name === subreddit} onClick={() => setSubreddit(name)}>
						r/{name}
					</Chip>
				))}
				<Button variant="secondary" onClick={() => setManage((value) => !value)}>
					{manage ? "Done" : "Manage"}
				</Button>
			</nav>

			{manage ? (
				<section className="reddit-v3-manager" aria-label="Manage subreddits">
					<div className="reddit-v3-add">
						<TextInput
							ariaLabel="New subreddit"
							placeholder="Add a subreddit"
							value={draft}
							onInput={setDraft}
						/>
						<Button disabled={!normalizeSubreddit(draft)} onClick={addSubreddit}>
							Add
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
					<Button
						variant="secondary"
						disabled={retrySeconds > 0}
						onClick={() => setRefresh((value) => value + 1)}
					>
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
		</main>
	);
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register("navlink", <NavLink localizedApp="Reddit" appRoutePath={ROUTE} icon={ICON} activeIcon={ICON} />);
	registrar.registerRoute(ROUTE, <Page />);
}
