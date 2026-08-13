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
import { Button, IconButton, Select, SettingsRow, SettingsSection, Toggle } from "/modules/stdlib/lib/primitives.js";
import {
	DAY_MS,
	dedupeAndSort,
	filterVisible,
	groupByDay,
	largestCover,
	mapPool,
	typeLabel,
	validateCache,
} from "./logic.ts";
import type { CacheShape, Release } from "./logic.ts";

const ROUTE = "/bespoke/new-releases";
const ICON = '<path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" fill="currentColor"/>';

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

const CONFIG_KEYS: Record<keyof Config, string> = {
	range: "range",
	relative: "relative",
	showType: "visual:type",
	showCount: "visual:count",
	album: "album",
	singleEp: "single-ep",
	compilations: "compilations",
};
const configListeners = new Set<() => void>();

const updateConfig = <K extends keyof Config>(key: K, value: Config[K]): void => {
	writeConfig(CONFIG_KEYS[key], String(value));
	for (const listener of configListeners) listener();
};

const useConfig = (): Config => {
	const [config, setConfig] = React.useState(readConfig);
	React.useEffect(() => {
		const refresh = () => setConfig(readConfig());
		configListeners.add(refresh);
		return () => {
			configListeners.delete(refresh);
		};
	}, []);
	return config;
};

const RANGE_OPTIONS = [
	{ value: "30", label: "30 days" },
	{ value: "60", label: "60 days" },
	{ value: "90", label: "90 days" },
	{ value: "120", label: "120 days" },
] as const;

const ConfigToggle = ({ label, configKey }: { label: string; configKey: Exclude<keyof Config, "range"> }) => {
	const id = React.useId();
	const config = useConfig();
	return (
		<SettingsRow label={label} htmlFor={id}>
			<Toggle id={id} value={config[configKey]} onChange={(value) => updateConfig(configKey, value)} />
		</SettingsRow>
	);
};

const NewReleasesSettings = () => {
	const config = useConfig();
	const rangeId = React.useId();
	return (
		<SettingsSection title="New Releases">
			<SettingsRow label="Release window" htmlFor={rangeId}>
				<Select
					options={RANGE_OPTIONS}
					value={String(config.range) as (typeof RANGE_OPTIONS)[number]["value"]}
					onChange={(value) => updateConfig("range", Number.parseInt(value, 10))}
				/>
			</SettingsRow>
			<ConfigToggle label="Albums" configKey="album" />
			<ConfigToggle label="Singles and EPs" configKey="singleEp" />
			<ConfigToggle label="Compilations" configKey="compilations" />
			<ConfigToggle label="Relative dates" configKey="relative" />
			<ConfigToggle label="Show release type" configKey="showType" />
			<ConfigToggle label="Show track count" configKey="showCount" />
		</SettingsSection>
	);
};

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

// The widest window any range option can request. We fetch and cache this
// superset once, then filter it per config in the view — so toggling a type
// chip or the range window is instant and never hits the network.
const MAX_RANGE_DAYS = 120;

async function fetchAllReleases(): Promise<Release[]> {
	const artists = await getFollowedArtists();
	const cutoff = Date.now() - MAX_RANGE_DAYS * DAY_MS;
	const releases = await mapPool(artists, 16, (a) => getArtistReleases(a, cutoff));
	return dedupeAndSort(releases);
}

// ---------- stale-while-revalidate cache ----------

const CACHE_KEY = "new-releases:cache";
const CACHE_VERSION = 1;
// Past this age the cached feed is revalidated in the background on next open;
// the cache is still shown immediately regardless of age. New releases land
// roughly daily (mostly Fridays), so a few hours of staleness is invisible.
const TTL_MS = 6 * 3600 * 1000;

const readCache = (): CacheShape | null => {
	try {
		return validateCache(JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? "null"), CACHE_VERSION);
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
	const cfg = useConfig();

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
	// a preference is instant and never triggers a network fetch.
	const visible = React.useMemo(
		() => filterVisible(releases, cfg, dismissedSet, Date.now()),
		[releases, dismissedSet, cfg.range, cfg.album, cfg.singleEp, cfg.compilations],
	);
	const groups = React.useMemo(
		() =>
			groupByDay(
				visible,
				cfg.relative,
				globalThis.localStorage?.getItem("new-releases:locale") || navigator.language,
				Date.now(),
			),
		[visible, cfg.relative],
	);

	return (
		<div className="new-releases-page">
			<div className="new-releases-header">
				<h1>New Releases</h1>
				<div className="new-releases-controls">
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
	registrar.register("settingsSection", <NewReleasesSettings />);
	registrar.register(
		"navlink",
		<NavLink localizedApp="New Releases" appRoutePath={ROUTE} icon={ICON} activeIcon={ICON} />,
	);
	registrar.registerRoute(ROUTE, <Page />);
}
