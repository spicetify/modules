/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const CSS = `
.spicetify-splash {
	position: fixed;
	inset: 0;
	width: 100vw;
	height: 100dvh;
	max-width: none;
	max-height: none;
	margin: 0;
	padding: 32px;
	box-sizing: border-box;
	border: 0;
	border-radius: 0 !important;
	box-shadow: none;
	background: #121212;
	overflow: hidden !important;
	opacity: 1;
	transition: opacity 180ms ease-out;
}
.spicetify-splash[open] { display: grid; place-items: center; }
.spicetify-splash::before, .spicetify-splash::after { content: none !important; }
.spicetify-splash::backdrop { background: transparent !important; }
.spicetify-splash-content {
	display: grid;
	justify-items: center;
	position: relative;
	isolation: isolate;
}
.spicetify-splash-content::before {
	content: "";
	position: absolute;
	inset: -96px -64px;
	z-index: -1;
	background: radial-gradient(circle, #ff5d3533 0%, #ff943317 35%, transparent 68%);
	opacity: 0.55;
	transform-origin: center;
	animation: spicetify-splash-glow 1800ms ease-in-out infinite;
}
.spicetify-splash-content img {
	display: block;
	object-fit: contain;
	transform-origin: center;
	animation: spicetify-splash-pulse 1800ms ease-in-out infinite;
}
@keyframes spicetify-splash-pulse {
	0%, 100% { transform: translateY(2px) scale(0.96); }
	50% { transform: translateY(-2px) scale(1.045); }
}
@keyframes spicetify-splash-glow {
	0%, 100% { transform: scale(0.85); opacity: 0.35; }
	50% { transform: scale(1.1); opacity: 0.8; }
}
.spicetify-splash-leaving { opacity: 0; }
.spicetify-splash-leaving .spicetify-splash-content img,
.spicetify-splash-leaving .spicetify-splash-content::before { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
	.spicetify-splash { transition: none; }
	.spicetify-splash-content img, .spicetify-splash-content::before { animation: none; }
}
`;
