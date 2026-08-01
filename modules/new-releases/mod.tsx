/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "new-releases" custom
 * app by khanhas. Like the original it builds the feed from the releases of
 * the artists you follow (LibraryAPI + the client's own GraphQL discography
 * query), grouped by release day. That native path is reliable, unlike the
 * public browse Web API a v3 module cannot proxy dependably.
 */

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { NavLink } from "/modules/stdlib/src/registers/navlink.tsx";
import { Button, Chip, IconButton, Select } from "/modules/stdlib/lib/primitives.js";

const ROUTE = "/bespoke/new-releases";
const ICON = '<path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor"/>';

const DAY_MS = 24 * 3600 * 1000;

interface Release {
	uri: string;
	title: string;
	artist: { name: string; uri: string };
	imageUrl: string;
	time: number;
	type: string;
	trackCount: number;
}

// ---------- persisted config (same keys as the classic app) ----------

const readBool = (key: string, fallback: boolean): boolean => {
	const raw = globalThis.localStorage?.getItem(`new-releases:${key}`);
	return raw === null || raw === undefined ? fallback : raw === "true";
};
const writeConfig = (key: string, value: string): void =>
	globalThis.localStorage?.setItem(`new-releases:${key}`, value);

interface Config {
	range: number;
	relative: boolean;
	showType: boolean;
	showCount: boolean;
	album: boolean;
	singleEp: boolean;
	compilations: boolean;
}

const readConfig = (): Config => ({
	range: Number.parseInt(globalThis.localStorage?.getItem("new-releases:range") ?? "30", 10) || 30,
	relative: readBool("relative", false),
	showType: readBool("visual:type", true),
	showCount: readBool("visual:count", true),
	album: readBool("album", true),
	singleEp: readBool("single-ep", true),
	compilations: readBool("compilations", false),
});

// ---------- dismissed set (persisted) ----------

const readDismissed = (): string[] => {
	try {
		const parsed = JSON.parse(globalThis.localStorage?.getItem("new-releases:dismissed") ?? "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};
const writeDismissed = (list: string[]): void =>
	globalThis.localStorage?.setItem("new-releases:dismissed", JSON.stringify(list));

// ---------- native data path ----------

// spotify:image:HASH is not a browser-loadable URL; map it to the CDN. The
// GraphQL coverArt sources are already http(s) URLs.
const artUrl = (raw?: string): string =>
	raw?.startsWith("spotify:image:") ? `https://i.scdn.co/image/${raw.slice("spotify:image:".length)}` : (raw ?? "");

const largestCover = (sources?: Array<{ url: string; width?: number }>): string => {
	if (!sources?.length) return "";
	const best = sources.reduce((prev, curr) => ((prev.width ?? 0) > (curr.width ?? 0) ? prev : curr));
	return artUrl(best.url);
};

// The artists the user follows (LibraryAPI content filtered to artists).
async function getFollowedArtists(): Promise<Array<{ name: string; uri: string }>> {
	const res = await Spicetify?.Platform?.LibraryAPI?.getContents?.({
		filters: ["1"],
		sortOrder: ["0"],
		textFilter: "",
		offset: 0,
		limit: 50000,
	});
	return res?.items ?? [];
}

// One artist's discography via the client's own persisted GraphQL query. Keeps
// every release type inside the widest window; type/range filtering happens in
// the view over the cached superset, not here.
async function getArtistReleases(artist: { name: string; uri: string }, cutoff: number): Promise<Release[]> {
	const def = Spicetify?.GraphQL?.Definitions?.queryArtistDiscographyAll ?? {
		name: "queryArtistDiscographyAll",
		operation: "query",
		sha256Hash: "9380995a9d4663cbcb5113fef3c6aabf70ae6d407ba61793fd01e2a1dd6929b0",
		value: null,
	};
	const { data, errors } = await Spicetify.GraphQL.Request(def, { uri: artist.uri, offset: 0, limit: 100 });
	if (errors) throw errors;

	const raw = data?.artistUnion?.discography?.all?.items?.flatMap((r: any) => r.releases?.items ?? []) ?? [];
	const typeLabel = (t: string): string | null => {
		if (t === "ALBUM") return "Album";
		if (t === "SINGLE" || t === "EP") return "Single/EP";
		if (t === "COMPILATION") return "Compilation";
		return null;
	};

	const out: Release[] = [];
	for (const rel of raw) {
		const label = typeLabel(rel.type);
		if (!label) continue;
		const time = Date.parse(rel.date?.isoString ?? "");
		if (Number.isNaN(time) || time < cutoff) continue;
		out.push({
			uri: rel.uri,
			title: rel.name,
			artist: { name: artist.name, uri: artist.uri },
			imageUrl: largestCover(rel.coverArt?.sources),
			time,
			type: label,
			trackCount: rel.tracks?.totalCount ?? 0,
		});
	}
	return out;
}

// Bounded-concurrency map so following hundreds of artists does not fire
// hundreds of requests at once; failures degrade to an empty contribution.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R[]>): Promise<R[]> {
	const out: R[] = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const item = items[cursor++];
			try {
				out.push(...(await fn(item)));
			} catch {
				/* one artist failing must not sink the feed */
			}
		}
	});
	await Promise.all(workers);
	return out;
}

// The widest window any range option can request. We fetch and cache this
// superset once, then filter it per config in the view — so toggling a type
// chip or the range window is instant and never hits the network.
const MAX_RANGE_DAYS = 120;

async function fetchAllReleases(): Promise<Release[]> {
	const artists = await getFollowedArtists();
	const cutoff = Date.now() - MAX_RANGE_DAYS * DAY_MS;
	const releases = await mapPool(artists, 16, (a) => getArtistReleases(a, cutoff));
	// A release can surface under several followed artists; keep the first.
	const seen = new Set<string>();
	const deduped = releases.filter((r) => (seen.has(r.uri) ? false : (seen.add(r.uri), true)));
	return deduped.sort((a, b) => b.time - a.time);
}

// ---------- stale-while-revalidate cache ----------

const CACHE_KEY = "new-releases:cache";
const CACHE_VERSION = 1;
// Past this age the cached feed is revalidated in the background on next open;
// the cache is still shown immediately regardless of age. New releases land
// roughly daily (mostly Fridays), so a few hours of staleness is invisible.
const TTL_MS = 6 * 3600 * 1000;

interface CacheShape {
	v: number;
	fetchedAt: number;
	releases: Release[];
}

const readCache = (): CacheShape | null => {
	try {
		const parsed = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? "null");
		if (!parsed || parsed.v !== CACHE_VERSION || !Array.isArray(parsed.releases)) return null;
		return parsed as CacheShape;
	} catch {
		return null;
	}
};
const writeCache = (cache: CacheShape): void => {
	try {
		globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(cache));
	} catch {
		/* quota or serialization failure: run without a persisted cache */
	}
};

// ---------- date grouping ----------

interface Group {
	label: string;
	items: Release[];
}

function groupByDay(items: Release[], cfg: Config): Group[] {
	const locale = globalThis.localStorage?.getItem("new-releases:locale") || navigator.language;
	const abs = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit" });
	const rel = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const startOfToday = new Date().setHours(0, 0, 0, 0);

	const labelFor = (time: number): string => {
		if (!cfg.relative) return abs.format(time);
		const days = Math.round((new Date(time).setHours(0, 0, 0, 0) - startOfToday) / DAY_MS);
		return rel.format(days, "day");
	};

	const groups: Group[] = [];
	let current: Group | undefined;
	for (const item of items) {
		const label = labelFor(item.time);
		if (!current || current.label !== label) {
			current = { label, items: [] };
			groups.push(current);
		}
		current.items.push(item);
	}
	return groups;
}

// ---------- navigation helpers ----------

const uriToPath = (uri: string): string => {
	try {
		return Spicetify?.URI?.fromString?.(uri)?.toURLPath?.(true) ?? "";
	} catch {
		return "";
	}
};
const navigate = (uri: string): void => {
	const path = uriToPath(uri);
	if (path) Spicetify?.Platform?.History?.push?.(path);
};

// ---------- card ----------

const PlayIcon = () => (
	<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
		<path d="M8 5v14l11-7z" fill="currentColor" />
	</svg>
);
const CloseIcon = () => (
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
		<path
			d="M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06Z"
			fill="currentColor"
			fillRule="evenodd"
		/>
	</svg>
);

const ReleaseCard = ({
	release,
	cfg,
	onDismiss,
}: {
	release: Release;
	cfg: Config;
	onDismiss: (uri: string) => void;
}) => {
	const detail: string[] = [];
	if (cfg.showType && release.type) detail.push(release.type);
	if (cfg.showCount && release.trackCount) {
		detail.push(`${release.trackCount} ${release.trackCount === 1 ? "song" : "songs"}`);
	}
	return (
		<div className="new-releases-card" onClick={() => navigate(release.uri)}>
			<div className="new-releases-cover-wrap">
				{release.imageUrl ? (
					<img className="new-releases-cover" src={release.imageUrl} alt="" loading="lazy" />
				) : (
					<div className="new-releases-cover new-releases-cover--empty" />
				)}
				<button
					type="button"
					className="new-releases-play"
					aria-label={`Play ${release.title}`}
					onClick={(e) => {
						e.stopPropagation();
						Spicetify?.Player?.playUri?.(release.uri);
					}}
				>
					<PlayIcon />
				</button>
				<button
					type="button"
					className="new-releases-dismiss"
					aria-label={`Dismiss ${release.title}`}
					onClick={(e) => {
						e.stopPropagation();
						onDismiss(release.uri);
					}}
				>
					<CloseIcon />
				</button>
			</div>
			<div className="new-releases-meta">
				<span className="new-releases-name" title={release.title}>
					{release.title}
				</span>
				{detail.length > 0 && <span className="new-releases-detail">{detail.join(" • ")}</span>}
				<span
					className="new-releases-artist"
					title={release.artist.name}
					onClick={(e) => {
						e.stopPropagation();
						navigate(release.artist.uri);
					}}
				>
					{release.artist.name}
				</span>
			</div>
		</div>
	);
};

// ---------- page ----------

type Phase = "loading" | "refreshing" | "idle";

const Page = () => {
	const [cache, setCache] = React.useState<CacheShape | null>(readCache);
	const [phase, setPhase] = React.useState<Phase>(cache ? "idle" : "loading");
	const [dismissed, setDismissed] = React.useState<string[]>(readDismissed);
	const [cfg, setCfg] = React.useState<Config>(readConfig);

	const releases = cache?.releases ?? [];

	// Each load claims a sequence number so a newer load (background revalidate,
	// manual refresh, or a remount) supersedes an in-flight one and only the
	// latest result lands. A setState after unmount is a harmless no-op.
	const gen = React.useRef(0);
	const load = React.useCallback(async (background: boolean) => {
		const seq = ++gen.current;
		setPhase(background ? "refreshing" : "loading");
		let list: Release[] | null = null;
		try {
			list = await fetchAllReleases();
		} catch {
			list = null;
		}
		if (seq !== gen.current) return;
		if (list) {
			const next: CacheShape = { v: CACHE_VERSION, fetchedAt: Date.now(), releases: list };
			setCache(next);
			writeCache(next);
		}
		setPhase("idle");
	}, []);

	// Stale-while-revalidate: cached releases render immediately (above). Fetch
	// only when there is no cache (foreground) or the cache has aged past the
	// TTL (background). Config toggles never refetch — they re-filter the cached
	// superset in the memo below. Runs once on mount.
	React.useEffect(() => {
		if (!cache) void load(false);
		else if (Date.now() - cache.fetchedAt > TTL_MS) void load(true);
	}, []);

	const update = (patch: Partial<Config>, persist: () => void) => {
		persist();
		setCfg((prev) => ({ ...prev, ...patch }));
	};

	const dismiss = (uri: string) => {
		setDismissed((prev) => {
			const next = prev.includes(uri) ? prev : [...prev, uri];
			writeDismissed(next);
			return next;
		});
	};
	const undo = () => {
		setDismissed((prev) => {
			const next = prev.slice(0, -1);
			writeDismissed(next);
			return next;
		});
	};

	const dismissedSet = React.useMemo(() => new Set(dismissed), [dismissed]);
	// All type/range filtering happens here over the cached superset, so changing
	// a chip or the range window is instant and never triggers a network fetch.
	const visible = React.useMemo(() => {
		const cutoff = Date.now() - cfg.range * DAY_MS;
		const typeOn = (label: string): boolean =>
			label === "Album" ? cfg.album : label === "Single/EP" ? cfg.singleEp : cfg.compilations;
		return releases.filter((r) => r.time >= cutoff && typeOn(r.type) && !dismissedSet.has(r.uri));
	}, [releases, dismissedSet, cfg.range, cfg.album, cfg.singleEp, cfg.compilations]);
	const groups = React.useMemo(() => groupByDay(visible, cfg), [visible, cfg.relative]);

	const rangeOptions = [
		{ value: "30", label: "30 days" },
		{ value: "60", label: "60 days" },
		{ value: "90", label: "90 days" },
		{ value: "120", label: "120 days" },
	] as const;

	return (
		<div className="new-releases-page">
			<div className="new-releases-header">
				<h1>New Releases</h1>
				<div className="new-releases-controls">
					<Select
						options={rangeOptions}
						value={String(cfg.range) as "30" | "60" | "90" | "120"}
						onChange={(v) => update({ range: Number.parseInt(v, 10) }, () => writeConfig("range", v))}
					/>
					<Chip
						active={cfg.album}
						onClick={() => update({ album: !cfg.album }, () => writeConfig("album", String(!cfg.album)))}
					>
						Albums
					</Chip>
					<Chip
						active={cfg.singleEp}
						onClick={() =>
							update({ singleEp: !cfg.singleEp }, () => writeConfig("single-ep", String(!cfg.singleEp)))
						}
					>
						Singles &amp; EPs
					</Chip>
					<Chip
						active={cfg.compilations}
						onClick={() =>
							update({ compilations: !cfg.compilations }, () =>
								writeConfig("compilations", String(!cfg.compilations)),
							)
						}
					>
						Compilations
					</Chip>
					<Chip
						active={cfg.relative}
						onClick={() =>
							update({ relative: !cfg.relative }, () => writeConfig("relative", String(!cfg.relative)))
						}
					>
						Relative dates
					</Chip>
					{dismissed.length > 0 && (
						<Button variant="secondary" onClick={undo}>
							Undo dismiss
						</Button>
					)}
					<IconButton
						ariaLabel="Refresh"
						disabled={phase !== "idle"}
						onClick={() => void load(releases.length > 0)}
					>
						⟳
					</IconButton>
					{phase === "refreshing" && <span className="new-releases-updating">Updating…</span>}
				</div>
			</div>

			{phase === "loading" && <p className="new-releases-note">Fetching releases from the artists you follow…</p>}
			{phase !== "loading" && releases.length === 0 && (
				<div className="new-releases-empty">
					<p>No releases in the last {MAX_RANGE_DAYS} days from the artists you follow.</p>
					<Button variant="secondary" onClick={() => void load(false)}>
						Try again
					</Button>
				</div>
			)}

			{phase !== "loading" && releases.length > 0 && groups.length === 0 && (
				<p className="new-releases-note">
					{visible.length === 0 && dismissed.length > 0
						? "Everything here has been dismissed. Use “Undo dismiss” to bring items back."
						: `No releases in the last ${cfg.range} days for the selected filters.`}
				</p>
			)}

			{phase !== "loading" &&
				groups.map((group) => (
					<section className="new-releases-group" key={group.label}>
						<h2 className="new-releases-date">{group.label}</h2>
						<div className="new-releases-grid">
							{group.items.map((r) => (
								<ReleaseCard key={r.uri} release={r} cfg={cfg} onDismiss={dismiss} />
							))}
						</div>
					</section>
				))}
		</div>
	);
};

export default async function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register(
		"navlink",
		<NavLink localizedApp="New Releases" appRoutePath={ROUTE} icon={ICON} activeIcon={ICON} />,
	);
	registrar.registerRoute(ROUTE, <Page />);
}
