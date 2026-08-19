/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { client, React } from "/modules/stdlib/mod.ts";
import { Badge } from "/modules/stdlib/lib/primitives.js";
import type { RedditItem } from "./logic.ts";

const PlayIcon = () => (
	<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
		<path d="M8 5v14l11-7z" fill="currentColor" />
	</svg>
);

const Placeholder = ({ kind }: { kind: RedditItem["kind"] }) => (
	<div className="reddit-v3-cover reddit-v3-cover--empty" aria-hidden="true">
		<svg viewBox="0 0 24 24" width="44" height="44">
			{kind === "playlist" ? (
				<path d="M4 5h16v2H4zm0 6h11v2H4zm0 6h8v2H4zm13-6 5 3.5-5 3.5z" fill="currentColor" />
			) : (
				<path
					d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Z"
					fill="currentColor"
				/>
			)}
		</svg>
	</div>
);

const navigate = (uri: string): void => {
	try {
		const path = client.uri.fromString(uri).toURLPath(true);
		if (path) client.platform.History.push(path);
	} catch {
		/* malformed or unsupported client URI: leave the card inert */
	}
};

export const RedditCard = ({ item }: { item: RedditItem }) => {
	const open = () => navigate(item.uri);
	return (
		<article
			className="reddit-v3-card"
			role="link"
			tabIndex={0}
			aria-label={`Open ${item.title}`}
			onClick={open}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					open();
				}
			}}
		>
			<div className="reddit-v3-cover-wrap">
				{item.imageUrl ? (
					<img className="reddit-v3-cover" src={item.imageUrl} alt="" loading="lazy" />
				) : (
					<Placeholder kind={item.kind} />
				)}
				<button
					type="button"
					className="reddit-v3-play"
					aria-label={`Play ${item.title}`}
					onClick={(event) => {
						event.stopPropagation();
						client.player.playUri(item.uri);
					}}
				>
					<PlayIcon />
				</button>
			</div>
			<div className="reddit-v3-card-copy">
				<strong title={item.title}>{item.title}</strong>
				<span title={item.subtitle}>{item.subtitle}</span>
				<div className="reddit-v3-card-detail">
					<Badge>
						{item.kind === "track" ? "Song" : `${item.kind[0].toUpperCase()}${item.kind.slice(1)}`}
					</Badge>
					{item.followers === undefined ? null : <span>{item.followers.toLocaleString()} likes</span>}
				</div>
			</div>
		</article>
	);
};
