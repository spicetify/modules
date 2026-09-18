/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pages.js — the 11 lyrics page components, the largest UI leaf. No references
// to lyricContainerUpdate/reloadLyrics, so no callback plumbing lives here.

import type { CSSProperties, ReactNode, ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import type { DisplayLyricLine, RenderedLyricLine, LyricWord, GeniusVersion } from "./types.ts";
import { client, React as react } from "/modules/stdlib/mod.ts";
import { CONFIG } from "./config.ts";
import { ProviderGenius } from "./providers/genius.ts";
import { convertParsedToLRC, convertParsedToUnsynced, lyricText, isKaraokeWords } from "./utils.ts";

const { useState, useEffect, useMemo, useRef } = react;

export function LyricsBackground({ image }: { image: string }) {
	const [failedImage, setFailedImage] = useState<string | null>(null);
	const source = image.startsWith("spotify:image:")
		? `https://i.scdn.co/image/${image.slice("spotify:image:".length)}`
		: image;
	return react.createElement(
		"div",
		{ className: "lyrics-lyricsContainer-LyricsBackground", "aria-hidden": true },
		source &&
			failedImage !== image &&
			react.createElement(
				"div",
				{ className: "lyrics-album-art" },
				[0, 1].map((layer) =>
					react.createElement("img", {
						key: layer,
						src: source,
						alt: "",
						draggable: false,
						onError: () => setFailedImage(image),
					}),
				),
			),
	);
}

interface CreditProps {
	reRenderLyricsPage?: boolean;
	provider?: string | null;
	copyright?: string | null;
}
interface LyricsPageProps extends CreditProps {
	lyrics: DisplayLyricLine[];
	isKara?: boolean;
	trackUri?: string;
}
type IndicatorStyle = CSSProperties & { "--position-index"?: number; "--animation-index"?: number };
interface IdlingIndicatorProps {
	isActive?: boolean;
	progress: number;
	delay: number;
	className?: string;
	style?: IndicatorStyle;
}
interface KaraokeLineProps {
	text: LyricWord[];
	isActive: boolean;
	position: number;
	startTime?: number;
	endTime?: number;
}
interface VersionSelectorProps {
	items: GeniusVersion[];
	index?: number;
	callback: (items: GeniusVersion[], index: number) => void;
}
interface GeniusPageProps extends CreditProps {
	lyrics: string;
	versions: GeniusVersion[];
	versionIndex?: number;
	onVersionChange: VersionSelectorProps["callback"];
	isSplitted: boolean;
	lyrics2?: string | null;
	versionIndex2?: number;
	onVersionChange2: VersionSelectorProps["callback"];
	trackUri?: string;
}
function renderLineText(text: DisplayLyricLine["text"]): ReactNode {
	return isKaraokeWords(text) ? text.map(({ word }) => word).join("") : text;
}

export const CreditFooter = react.memo(({ provider, copyright }: CreditProps) => {
	if (provider === "local") return null;
	const credit = [client.locale.get("web-player.lyrics.providedBy", provider)];
	if (copyright) {
		credit.push(...copyright.split("\n"));
	}

	return (
		provider &&
		react.createElement(
			"p",
			{
				className: "lyrics-lyricsContainer-Provider main-type-mesto",
				dir: "auto",
			},
			credit.join(" • "),
		)
	);
});

export const IdlingIndicator = ({ isActive, progress, delay, className = "", style = {} }: IdlingIndicatorProps) => {
	return react.createElement(
		"div",
		{
			className:
				`lyrics-idling-indicator ${isActive === false ? "lyrics-idling-indicator-hidden" : ""} ${className}`.trim(),
			style: {
				"--indicator-delay": `${delay}ms`,
				...style,
			},
		},
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.05 ? "active" : ""}`,
		}),
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.33 ? "active" : ""}`,
		}),
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.66 ? "active" : ""}`,
		}),
	);
};

export const emptyLine: DisplayLyricLine = {
	startTime: 0,
	endTime: 0,
	text: [],
};

const isPauseLine = (text: DisplayLyricLine["text"]) => {
	const trimmed = lyricText(text).trim();
	return trimmed === "♪" || trimmed === "";
};

const findNextLineStartTime = (lines: DisplayLyricLine[], fromIndex: number) => {
	for (let j = fromIndex + 1; j < lines.length; j++) {
		if (!isPauseLine(lines[j].text) && lines[j].startTime != null) {
			return lines[j].startTime;
		}
	}
	return null;
};

const getPauseIndicator = (
	lyrics: DisplayLyricLine[],
	lineNumber: number,
	startTime: number | undefined,
	position: number,
	isFocused: boolean,
	isPause: boolean,
) => {
	if (!isFocused || !isPause) return null;

	const nextStart = findNextLineStartTime(lyrics, lineNumber);
	const pauseStart = startTime || 0;
	const pauseDuration = nextStart ? nextStart - pauseStart : 0;
	const progress = pauseDuration > 0 ? (position - pauseStart) / pauseDuration : 0;
	const delay = pauseDuration / 3;

	return react.createElement(IdlingIndicator, {
		progress,
		delay,
	});
};

export const LONG_PAUSE_THRESHOLD = 8000; // 8 seconds

const processPauseLines = (lyrics: DisplayLyricLine[]): DisplayLyricLine[] => {
	if (!lyrics || !lyrics.length) return lyrics;
	const result: DisplayLyricLine[] = [];
	for (let i = 0; i < lyrics.length; i++) {
		const line = lyrics[i];
		const nextLine = lyrics[i + 1];

		if (isPauseLine(line.text)) {
			// Skip consecutive pause lines to consolidate them into one idling indicator
			const lastLine = result[result.length - 1];
			if (lastLine && isPauseLine(lastLine.text)) {
				continue;
			}
			const nextStart = findNextLineStartTime(lyrics, i);
			const pauseStart = line.startTime || 0;
			if (nextStart != null) {
				const pauseDuration = nextStart - pauseStart;
				if (pauseDuration >= LONG_PAUSE_THRESHOLD) {
					result.push(line);
				}
			}
		} else {
			result.push(line);
			const hasLineEndTime = line.endTime != null && line.endTime > (line.startTime ?? 0);
			const endTime = hasLineEndTime ? line.endTime : null;
			if (endTime != null && nextLine && nextLine.startTime != null) {
				const gap = nextLine.startTime - endTime;
				if (
					gap >= LONG_PAUSE_THRESHOLD &&
					nextLine.startTime > (line.startTime ?? 0) &&
					!isPauseLine(nextLine.text)
				) {
					result.push({
						text: "♪",
						startTime: endTime,
						endTime: nextLine.startTime,
					});
				}
			}
		}
	}
	return result;
};

const isRTLText = (str: string) => /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(str);

const renderPerformer = (
	performer: string | null | undefined,
	previousPerformer: string | null | undefined,
	compact: boolean,
) => {
	if (!CONFIG.visual["show-performers"] || !performer || (!compact && previousPerformer === performer)) return null;
	return react.createElement("span", { className: "lyrics-lyricsContainer-Performer" }, performer);
};

export const useTrackPosition = (callback: () => void) => {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	useEffect(() => {
		const interval = setInterval(callbackRef.current, 50);

		return () => {
			clearInterval(interval);
		};
	}, [callbackRef]);
};

export const KaraokeLine = ({ text, isActive, position, startTime = 0, endTime }: KaraokeLineProps) => {
	if ((endTime != null && position > endTime) || (!isActive && position > startTime)) {
		return text.map(({ word }) => word);
	}

	let accumulatedTime = startTime;
	return text.map(({ word, time }, i) => {
		const isRTL = isRTLText(typeof word === "string" ? word : "");
		const isWordActive = position >= accumulatedTime;
		accumulatedTime += time;
		const isWordComplete = isWordActive && position >= accumulatedTime;
		return react.createElement(
			"span",
			{
				key: i,
				className: `lyrics-lyricsContainer-Karaoke-Word${isWordActive ? " lyrics-lyricsContainer-Karaoke-WordActive" : ""}${isRTL ? " lyrics-lyricsContainer-Karaoke-WordRTL" : ""}`,
				style: {
					"--word-duration": `${time}ms`,
					// don't animate unless we have to
					transition: !isWordActive || isWordComplete ? "all 0s linear" : "",
				},
			},
			word,
		);
	});
};

export const SyncedLyricsPage = react.memo(({ lyrics = [], provider, copyright, isKara }: LyricsPageProps) => {
	const [position, setPosition] = useState(0);
	const activeLineEle = useRef<HTMLDivElement>(null);
	const lyricContainerEle = useRef<HTMLDivElement>(null);

	useTrackPosition(() => {
		const newPos = client.player.getProgress();
		const delay = CONFIG.visual["global-delay"] + CONFIG.visual.delay;
		if (newPos !== position) {
			setPosition(newPos + delay);
		}
	});

	const lyricWithEmptyLines = useMemo(
		() =>
			[emptyLine, emptyLine, ...processPauseLines(lyrics)].map((line, i) => ({
				...line,
				lineNumber: i,
			})),
		[lyrics],
	);

	const lyricsId = lyricText(lyrics[0]?.text);

	let activeLineIndex = 0;
	for (let i = lyricWithEmptyLines.length - 1; i > 0; i--) {
		if (position >= (lyricWithEmptyLines[i].startTime ?? 0)) {
			// If this is a pause line and the next one starts at the same time and is NOT a pause line,
			// prefer the next line (the text).
			if (
				isPauseLine(lyricWithEmptyLines[i].text) &&
				lyricWithEmptyLines[i + 1] &&
				position >= (lyricWithEmptyLines[i + 1].startTime ?? 0) &&
				!isPauseLine(lyricWithEmptyLines[i + 1].text)
			) {
				continue;
			}
			activeLineIndex = i;
			break;
		}
	}

	const { activeLines, activeElementIndex } = useMemo(() => {
		let startIndex = activeLineIndex;
		let visibleBefore = 0;
		const targetBefore = Number(CONFIG.visual["lines-before"]) + 1;
		while (startIndex > 0 && visibleBefore < targetBefore) {
			startIndex--;
			if (!isPauseLine(lyricWithEmptyLines[startIndex].text)) {
				visibleBefore++;
			}
		}

		let endIndex = activeLineIndex;
		let visibleAfter = 0;
		const targetAfter = Number(CONFIG.visual["lines-after"]) + 1;
		while (endIndex < lyricWithEmptyLines.length - 1 && visibleAfter < targetAfter) {
			endIndex++;
			if (!isPauseLine(lyricWithEmptyLines[endIndex].text)) {
				visibleAfter++;
			}
		}

		return {
			activeLines: lyricWithEmptyLines.slice(startIndex, endIndex + 1),
			activeElementIndex: activeLineIndex - startIndex,
		};
	}, [activeLineIndex, lyricWithEmptyLines, CONFIG.visual["lines-before"], CONFIG.visual["lines-after"]]);

	let offset = lyricContainerEle.current ? lyricContainerEle.current.clientHeight / 2 : 0;
	if (activeLineEle.current) {
		offset += -(activeLineEle.current.offsetTop + activeLineEle.current.clientHeight / 2);
	}
	const adjustedAnimationIndices: number[] = [];
	let currentIndex = 0;
	for (let j = activeElementIndex; j < activeLines.length; j++) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!isPauseLine(activeLines[j].text) || j === activeElementIndex) {
			currentIndex++;
		}
	}
	currentIndex = -1;
	for (let j = activeElementIndex - 1; j >= 0; j--) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!isPauseLine(activeLines[j].text)) {
			currentIndex--;
		}
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-SyncedLyricsPage",
			ref: lyricContainerEle,
		},
		react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-SyncedLyrics",
				style: {
					"--offset": `${offset}px`,
				},
				key: lyricsId,
			},
			activeLines.map(({ text, lineNumber, startTime, endTime, originalText, performer }, i) => {
				const isFocusedLine = activeElementIndex === i;
				const isPause = isPauseLine(text);

				// Calculate indicator state for pause lines
				const indicatorEl = getPauseIndicator(
					lyricWithEmptyLines,
					lineNumber,
					startTime,
					position,
					isFocusedLine,
					isPause,
				);

				let className = "lyrics-lyricsContainer-LyricsLine";
				let ref;

				const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
				const isActive = isFocusedLine || isPlaying;

				if (isFocusedLine) {
					ref = activeLineEle;
				}
				if (isActive) {
					className += " lyrics-lyricsContainer-LyricsLine-active";
				} else if (isPause && !indicatorEl) {
					className += " lyrics-lyricsContainer-LyricsLine-hidden";
				}

				let animationIndex = adjustedAnimationIndices[i];

				const paddingLine =
					(animationIndex < 0 && -animationIndex > Number(CONFIG.visual["lines-before"])) ||
					animationIndex > Number(CONFIG.visual["lines-after"]);
				if (paddingLine) {
					className += " lyrics-lyricsContainer-LyricsLine-paddingLine";
				}
				const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
				// If we have original text and we are showing translated below, we should show the original text
				// Otherwise we should show the translated text
				const lineText = originalText && showTranslatedBelow ? originalText : text;

				// Convert lyrics to text for comparison
				const belowOrigin = lyricText(originalText).replace(/\s+/g, "");
				const belowTxt = lyricText(text).replace(/\s+/g, "");
				const belowMode = showTranslatedBelow && Boolean(originalText) && belowOrigin !== belowTxt;

				return react.createElement(
					"div",
					{
						className,
						style: {
							cursor: "pointer",
							"--position-index": animationIndex,
							"--animation-index": (animationIndex < 0 ? 0 : animationIndex) + 1,
							"--blur-index": Math.abs(animationIndex),
						},
						dir: "auto",
						ref,
						key: lineNumber,
						onClick: () => {
							if (startTime) {
								client.player.seek(startTime);
							}
						},
					},
					isPause
						? indicatorEl
						: react.createElement(
								"p",
								{
									onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
										event.preventDefault();
										client.platform.ClipboardAPI.copy(
											convertParsedToLRC(lyrics, belowMode).original,
										)
											.then(() => client.notify("Lyrics copied to clipboard"))
											.catch(() => client.notify("Failed to copy lyrics to clipboard"));
									},
								},
								renderPerformer(
									performer,
									lyricWithEmptyLines[lineNumber - 1]?.performer,
									CONFIG.visual["synced-compact"],
								),
								!(isKara && isKaraokeWords(text))
									? renderLineText(lineText)
									: react.createElement(KaraokeLine, {
											text,
											startTime,
											endTime,
											position,
											isActive,
										}),
							),
					belowMode &&
						react.createElement(
							"p",
							{
								style: {
									opacity: 0.5,
								},
								onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
									event.preventDefault();
									client.platform.ClipboardAPI.copy(convertParsedToLRC(lyrics, belowMode).conver)
										.then(() => client.notify("Translated lyrics copied to clipboard"))
										.catch(() => client.notify("Failed to copy translated lyrics to clipboard"));
								},
							},
							renderLineText(text),
						),
				);
			}),
		),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
	);
});

interface SearchBarState {
	hidden: boolean;
	atNode: number;
	foundNodes: Range[];
}
export class SearchBar extends react.Component<Record<never, never>, SearchBarState> {
	state: SearchBarState = { hidden: true, atNode: 0, foundNodes: [] };
	container: HTMLInputElement | null = null;
	viewPort: HTMLElement | null = null;
	mainViewOffsetTop = 0;
	toggleCallback = () => {
		if (!(client.platform.History.location.pathname === "/lyrics-plus" && this.container)) return;
		if (this.state.hidden) {
			this.setState({ hidden: false });
			this.container.focus();
		} else {
			this.setState({ hidden: true });
			this.container.blur();
		}
	};
	unFocusCallback = () => {
		this.container?.blur();
		this.setState({ hidden: true });
	};
	loopThroughCallback = (event: KeyboardEvent) => {
		if (!this.state.foundNodes.length || event.key !== "Enter") return;
		const dir = event.shiftKey ? -1 : 1;
		const atNode = (this.state.atNode + dir + this.state.foundNodes.length) % this.state.foundNodes.length;
		const rects = this.state.foundNodes[atNode].getBoundingClientRect();
		this.viewPort?.scrollBy(0, rects.y - 100);
		this.setState({ atNode });
	};
	componentDidMount() {
		this.viewPort = document.querySelector<HTMLElement>(".main-view-container .os-viewport");
		this.mainViewOffsetTop = document.querySelector<HTMLElement>(".Root__main-view")?.offsetTop ?? 0;
		client.mousetrap().bind("mod+shift+f", this.toggleCallback);
		if (!this.container) return;
		client.mousetrap(this.container).bind("mod+shift+f", this.toggleCallback);
		client.mousetrap(this.container).bind("enter", this.loopThroughCallback);
		client.mousetrap(this.container).bind("shift+enter", this.loopThroughCallback);
		client.mousetrap(this.container).bind("esc", this.unFocusCallback);
	}
	componentWillUnmount() {
		client.mousetrap().unbind("mod+shift+f");
		if (!this.container) return;
		client.mousetrap(this.container).unbind("mod+shift+f");
		client.mousetrap(this.container).unbind("enter");
		client.mousetrap(this.container).unbind("shift+enter");
		client.mousetrap(this.container).unbind("esc");
	}

	getNodeFromInput(event: ChangeEvent<HTMLInputElement>) {
		const value = event.currentTarget.value.toLowerCase();
		if (!value) {
			this.setState({ foundNodes: [] });
			this.viewPort?.scrollTo(0, 0);
			return;
		}

		const lyricsPage = document.querySelector(".lyrics-lyricsContainer-UnsyncedLyricsPage");
		if (!lyricsPage) return;
		const walker = document.createTreeWalker(lyricsPage, NodeFilter.SHOW_TEXT, (node) => {
			if ((node.textContent ?? "").toLowerCase().includes(value)) {
				return NodeFilter.FILTER_ACCEPT;
			}
			return NodeFilter.FILTER_REJECT;
		});

		const foundNodes = [];
		while (walker.nextNode()) {
			const range = document.createRange();
			range.selectNodeContents(walker.currentNode);
			foundNodes.push(range);
		}

		if (!foundNodes.length) {
			this.viewPort?.scrollBy(0, 0);
		} else {
			const rects = foundNodes[0].getBoundingClientRect();
			this.viewPort?.scrollBy(0, rects.y - 100);
		}

		this.setState({ foundNodes, atNode: 0 });
	}

	render() {
		let y = 0;
		let height = 0;
		if (this.state.foundNodes.length) {
			const node = this.state.foundNodes[this.state.atNode];
			const rects = node.getBoundingClientRect();
			y = rects.y + (this.viewPort?.scrollTop ?? 0) - this.mainViewOffsetTop;
			height = rects.height;
		}
		return react.createElement(
			"div",
			{
				className: `lyrics-Searchbar${this.state.hidden ? " hidden" : ""}`,
			},
			react.createElement("input", {
				ref: (c: HTMLInputElement | null): void => {
					this.container = c;
				},
				onChange: this.getNodeFromInput.bind(this),
			}),
			react.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				dangerouslySetInnerHTML: {
					__html: client.icons.search,
				},
			}),
			react.createElement(
				"span",
				{
					hidden: this.state.foundNodes.length === 0,
				},
				`${this.state.atNode + 1}/${this.state.foundNodes.length}`,
			),
			react.createElement("div", {
				className: "lyrics-Searchbar-highlight",
				style: {
					"--search-highlight-top": `${y}px`,
					"--search-highlight-height": `${height}px`,
				},
			}),
		);
	}
}

function isInViewport(element: Element) {
	const rect = element.getBoundingClientRect();
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		rect.right <= (window.innerWidth || document.documentElement.clientWidth)
	);
}

export const SyncedExpandedLyricsPage = react.memo(({ lyrics, provider, copyright, isKara }: LyricsPageProps) => {
	const [position, setPosition] = useState(
		() => client.player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay,
	);
	const activeLineRef = useRef<HTMLDivElement>(null);
	const pageRef = useRef<HTMLDivElement>(null);

	useTrackPosition(() => {
		if (client.player.isPlaying()) {
			setPosition(client.player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay);
		}
	});

	const padded = useMemo(() => [emptyLine, ...processPauseLines(lyrics)], [lyrics]);

	const initialScroll = useRef(true);

	// Reset scroll state when lyrics change
	useEffect(() => {
		initialScroll.current = true;
	}, [lyrics]);

	const lyricsId = lyricText(lyrics[0]?.text);

	let activeLineIndex = 0;
	for (let i = padded.length - 1; i >= 0; i--) {
		const line = padded[i];
		if (position >= (line.startTime ?? 0)) {
			// If this is a pause line and the next one starts at the same time and is NOT a pause line,
			// prefer the next line (the text).
			if (
				isPauseLine(line.text) &&
				padded[i + 1] &&
				position >= (padded[i + 1].startTime ?? 0) &&
				!isPauseLine(padded[i + 1].text)
			) {
				continue;
			}
			activeLineIndex = i;
			break;
		}
	}

	useEffect(() => {
		if (activeLineRef.current && (initialScroll.current || isInViewport(activeLineRef.current))) {
			// Ignore focus on the first "empty" idling indicator if it's during initial load
			if (initialScroll.current && activeLineIndex === 0) {
				const nextStart = findNextLineStartTime(padded, 0);
				// If the intro is very short (e.g. less than 300ms), don't focus it
				if (nextStart && nextStart - position < 300) {
					initialScroll.current = false;
					return;
				}
			}

			activeLineRef.current.scrollIntoView({
				behavior: initialScroll.current ? "auto" : "smooth",
				block: "center",
				inline: "nearest",
			});
			initialScroll.current = false;
		}
	}, [activeLineIndex, lyricsId]);

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage lyrics-expanded-synced",
			key: lyricsId,
			ref: pageRef,
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		padded.map(({ text, startTime, endTime, originalText, performer }, i) => {
			// Show idling indicator for the initial empty line
			if (i === 0) {
				const nextStart = findNextLineStartTime(padded, 0);
				return react.createElement(IdlingIndicator, {
					key: i,
					isActive: activeLineIndex === 0,
					progress: nextStart ? position / nextStart : 0,
					delay: nextStart ? nextStart / 3 : 0,
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					style: { "--position-index": 0, "--animation-index": 1 },
				});
			}

			const isFocused = i === activeLineIndex;
			const isPause = isPauseLine(text);

			// Calculate indicator state for pause lines
			const indicatorEl = getPauseIndicator(padded, i, startTime, position, isFocused, isPause);

			const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
			const isPast =
				(endTime != null && position > endTime) || (!isFocused && startTime != null && position > startTime);
			const isActive = isFocused || isPlaying;

			let className = `lyrics-lyricsContainer-LyricsLine${isActive ? " lyrics-lyricsContainer-LyricsLine-active" : ""}${isPast ? " lyrics-lyricsContainer-LyricsLine-past" : ""}`;
			if (isPause && !indicatorEl) {
				className += " lyrics-lyricsContainer-LyricsLine-hidden";
			}

			const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
			// If we have original text and we are showing translated below, we should show the original text
			// Otherwise we should show the translated text
			const lineText = originalText && showTranslatedBelow ? originalText : text;

			// Convert lyrics to text for comparison
			const belowOrigin = lyricText(originalText).replace(/\s+/g, "");
			const belowTxt = lyricText(text).replace(/\s+/g, "");
			const belowMode = showTranslatedBelow && Boolean(originalText) && belowOrigin !== belowTxt;

			return react.createElement(
				"div",
				{
					className,
					key: i,
					style: {
						cursor: "pointer",
						"--blur-index": isActive ? 0 : Math.min(Math.abs(i - activeLineIndex), 4),
					},
					dir: "auto",
					ref: isFocused ? activeLineRef : null,
					onClick: () => {
						if (startTime) {
							client.player.seek(startTime);
						}
					},
				},
				isPause
					? indicatorEl
					: react.createElement(
							"p",
							{
								onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
									event.preventDefault();
									client.platform.ClipboardAPI.copy(convertParsedToLRC(lyrics, belowMode).original)
										.then(() => client.notify("Lyrics copied to clipboard"))
										.catch(() => client.notify("Failed to copy lyrics to clipboard"));
								},
							},
							renderPerformer(performer, padded[i - 1]?.performer, CONFIG.visual["synced-compact"]),
							!(isKara && isKaraokeWords(text))
								? renderLineText(lineText)
								: react.createElement(KaraokeLine, { text, startTime, endTime, position, isActive }),
						),
				belowMode &&
					react.createElement(
						"p",
						{
							style: { opacity: 0.5 },
							onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
								event.preventDefault();
								client.platform.ClipboardAPI.copy(convertParsedToLRC(lyrics, belowMode).conver)
									.then(() => client.notify("Translated lyrics copied to clipboard"))
									.catch(() => client.notify("Failed to copy translated lyrics to clipboard"));
							},
						},
						renderLineText(text),
					),
			);
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
		react.createElement(SearchBar, null),
	);
});

export const UnsyncedLyricsPage = react.memo(
	({ lyrics, provider, copyright }: CreditProps & { lyrics: RenderedLyricLine[]; trackUri?: string }) => {
		return react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			},
			react.createElement("p", {
				className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
			}),
			lyrics.map(({ text, originalText, performer }, index) => {
				const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
				// If we have original text and we are showing translated below, we should show the original text
				// Otherwise we should show the translated text
				const lineText = originalText && showTranslatedBelow ? originalText : text;

				// Convert lyrics to text for comparison
				const belowOrigin = lyricText(originalText).replace(/\s+/g, "");
				const belowTxt = lyricText(text).replace(/\s+/g, "");
				const belowMode = showTranslatedBelow && Boolean(originalText) && belowOrigin !== belowTxt;

				return react.createElement(
					"div",
					{
						className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
						key: index,
						dir: "auto",
					},
					react.createElement(
						"p",
						{
							onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
								event.preventDefault();
								client.platform.ClipboardAPI.copy(convertParsedToUnsynced(lyrics, belowMode).original)
									.then(() => client.notify("Lyrics copied to clipboard"))
									.catch(() => client.notify("Failed to copy lyrics to clipboard"));
							},
						},
						renderPerformer(performer, lyrics[index - 1]?.performer, false),
						lineText,
					),
					belowMode &&
						react.createElement(
							"p",
							{
								style: { opacity: 0.5 },
								onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
									event.preventDefault();
									client.platform.ClipboardAPI.copy(convertParsedToUnsynced(lyrics, belowMode).conver)
										.then(() => client.notify("Translated lyrics copied to clipboard"))
										.catch(() => client.notify("Failed to copy translated lyrics to clipboard"));
								},
							},
							renderLineText(text),
						),
				);
			}),
			react.createElement("p", {
				className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
			}),
			react.createElement(CreditFooter, {
				provider,
				copyright,
			}),
			react.createElement(SearchBar, null),
		);
	},
);

const noteContainer = document.createElement("div");
noteContainer.classList.add("lyrics-Genius-noteContainer");
const noteDivider = document.createElement("div");
noteDivider.classList.add("lyrics-Genius-divider");
noteDivider.innerHTML = `<svg width="32" height="32" viewBox="0 0 13 4" fill="currentColor"><path d="M13 10L8 4.206 3 10z"/></svg>`;
noteDivider.style.setProperty("--link-left", "0");
const noteTextContainer = document.createElement("div");
noteTextContainer.classList.add("lyrics-Genius-noteTextContainer");
noteTextContainer.onclick = (event) => {
	event.preventDefault();
	event.stopPropagation();
};
noteContainer.append(noteDivider, noteTextContainer);

function showNote(parent: HTMLElement, note: string) {
	if (noteContainer.parentElement === parent) {
		noteContainer.remove();
		return;
	}
	noteTextContainer.innerText = note;
	parent.append(noteContainer);
	const arrowPos = parent.offsetLeft - noteContainer.offsetLeft;
	noteDivider.style.setProperty("--link-left", `${arrowPos}px`);
	const box = noteTextContainer.getBoundingClientRect();
	if (box.y + box.height > window.innerHeight) {
		// Wait for noteContainer is mounted
		setTimeout(() => {
			noteContainer.scrollIntoView({
				behavior: "smooth",
				block: "center",
				inline: "nearest",
			});
		}, 50);
	}
}

export const GeniusPage = react.memo(
	({
		lyrics,
		provider,
		copyright,
		versions,
		versionIndex,
		onVersionChange,
		isSplitted,
		lyrics2,
		versionIndex2,
		onVersionChange2,
	}: GeniusPageProps) => {
		let notes: Record<string, string> = {};
		let container: HTMLDivElement | null = null;
		let container2: HTMLDivElement | null = null;

		// Fetch notes
		useEffect(() => {
			if (!container) return;
			const controller = new AbortController();
			notes = {};
			let links = Array.from(container.querySelectorAll("a"));
			if (isSplitted && container2) {
				links = [...links, ...container2.querySelectorAll("a")];
			}
			for (const link of links) {
				const id = link.pathname.match(/\/(\d+)\//)?.[1] ?? link.dataset.id;
				if (!id) continue;
				ProviderGenius.getNote(id, controller.signal)
					.then((note) => {
						if (controller.signal.aborted || note == null) return;
						notes[id] = note;
						link.classList.add("fetched");
					})
					.catch(() => {});
				link.onclick = (event) => {
					event.preventDefault();
					if (!notes[id]) return;
					showNote(link, notes[id]);
				};
			}
			return () => {
				controller.abort();
				for (const link of links) link.onclick = null;
			};
		}, [lyrics, lyrics2]);

		const lyricsEl1 = react.createElement(
			"div",
			null,
			react.createElement(VersionSelector, { items: versions, index: versionIndex, callback: onVersionChange }),
			react.createElement("div", {
				className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
				ref: (c: HTMLDivElement | null): void => {
					container = c;
				},
				dangerouslySetInnerHTML: {
					__html: lyrics,
				},
				onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
					client.platform.ClipboardAPI.copy(copylyrics)
						.then(() => client.notify("Lyrics copied to clipboard"))
						.catch(() => client.notify("Failed to copy lyrics to clipboard"));
				},
			}),
		);

		const mainContainer = [lyricsEl1];
		const shouldSplit = versions.length > 1 && isSplitted;

		if (shouldSplit) {
			const lyricsEl2 = react.createElement(
				"div",
				null,
				react.createElement(VersionSelector, {
					items: versions,
					index: versionIndex2,
					callback: onVersionChange2,
				}),
				react.createElement("div", {
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					ref: (c: HTMLDivElement | null): void => {
						container2 = c;
					},
					dangerouslySetInnerHTML: {
						__html: lyrics2 ?? "",
					},
					onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
						event.preventDefault();
						const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
						client.platform.ClipboardAPI.copy(copylyrics)
							.then(() => client.notify("Lyrics copied to clipboard"))
							.catch(() => client.notify("Failed to copy lyrics to clipboard"));
					},
				}),
			);
			mainContainer.push(lyricsEl2);
		}

		return react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			},
			react.createElement("p", {
				className: "lyrics-lyricsContainer-LyricsUnsyncedPadding main-type-ballad",
			}),
			react.createElement("div", { className: shouldSplit ? "split" : "" }, mainContainer),
			react.createElement(CreditFooter, {
				provider,
				copyright,
			}),
			react.createElement(SearchBar, null),
		);
	},
);

export const LoadingIcon = react.createElement(
	"svg",
	{
		width: "200px",
		height: "200px",
		viewBox: "0 0 100 100",
		preserveAspectRatio: "xMidYMid",
	},
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
	),
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
	),
);

export const VersionSelector = react.memo(({ items, index, callback }: VersionSelectorProps) => {
	if (items.length < 2) {
		return null;
	}
	return react.createElement(
		"div",
		{
			className: "lyrics-versionSelector",
		},
		react.createElement(
			"select",
			{
				onChange: (event: ChangeEvent<HTMLSelectElement>) => {
					callback(items, Number(event.currentTarget.value));
				},
				value: index,
			},
			items.map((a, i) => {
				return react.createElement("option", { key: i, value: i }, a.title);
			}),
		),
		react.createElement(
			"svg",
			{
				height: "16",
				width: "16",
				fill: "currentColor",
				viewBox: "0 0 16 16",
			},
			react.createElement("path", {
				d: "M3 6l5 5.794L13 6z",
			}),
		),
	);
});
