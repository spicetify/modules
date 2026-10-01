/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Everything sits in a cascade layer so any unlayered theme or custom rule
// wins without !important. The !important declarations on the dialog only
// pin the full-screen shell against generic `dialog` theme rules.
export const CSS = `
@layer spicetify-splash {
.spicetify-splash {
	--_background: var(--splash-background, var(--spice-main, #121212));
	--_foreground: var(--splash-foreground, var(--spice-text, #ffffff));
	--_accent: var(--splash-accent, var(--spice-button, #f26b3a));
	--_glow: var(--splash-glow, var(--_accent));
	--_glow-opacity: var(--splash-glow-opacity, 0.32);
	--_logo-size: var(--splash-logo-size, 96px);
	--_image-size: var(--splash-image-size, 160px);
	--_motion: var(--splash-motion-duration, 3.2s);
	--_exit: var(--splash-exit-duration, 250ms);
	position: fixed !important;
	inset: 0 !important;
	width: 100vw !important;
	height: 100vh !important;
	max-width: none !important;
	max-height: none !important;
	margin: 0 !important;
	padding: 0 !important;
	border: 0 !important;
	border-radius: 0 !important;
	box-shadow: none !important;
	outline: none !important;
	background: transparent !important;
	overflow: hidden !important;
	color: var(--_foreground);
	font-family: var(--splash-font, inherit);
}
.spicetify-splash[open] { display: block !important; }
.spicetify-splash::before, .spicetify-splash::after { content: none !important; display: none !important; }
.spicetify-splash::backdrop { background: transparent !important; }

.spicetify-splash__surface {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	isolation: isolate;
	overflow: hidden;
	background: var(--_background);
	transition: opacity var(--_exit) ease-out;
}
.spicetify-splash__backdrop {
	position: absolute;
	inset: 0;
	z-index: -1;
	pointer-events: none;
	opacity: var(--_glow-opacity);
}
.spicetify-splash__backdrop::before, .spicetify-splash__backdrop::after {
	content: "";
	position: absolute;
	left: 50%;
	top: 50%;
	width: 56vmin;
	height: 56vmin;
	translate: -50% -50%;
	border-radius: 50%;
	background: radial-gradient(
		closest-side,
		var(--_glow),
		color-mix(in srgb, var(--_glow) 55%, transparent) 30%,
		color-mix(in srgb, var(--_glow) 20%, transparent) 60%,
		color-mix(in srgb, var(--_glow) 5%, transparent) 82%,
		transparent
	);
	animation: spicetify-splash-drift calc(var(--_motion) * 3) ease-in-out infinite alternate;
}
.spicetify-splash__backdrop::after {
	--_glow: var(--splash-glow-secondary, var(--splash-logo-end, #e8473c));
	width: 120vmax;
	height: 120vmax;
	opacity: 0.35;
	animation-duration: calc(var(--_motion) * 5);
	animation-direction: alternate-reverse;
}

.spicetify-splash__content {
	display: flex;
	flex-direction: column;
	align-items: center;
	animation: spicetify-splash-enter 600ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	transition: scale var(--_exit) cubic-bezier(0.4, 0, 1, 1);
}
.spicetify-splash__logo {
	display: grid;
	place-items: center;
	width: var(--_logo-size);
	aspect-ratio: 250 / 376;
	filter: drop-shadow(0 12px 40px color-mix(in srgb, var(--_glow) 45%, transparent));
}
.spicetify-splash__logo > * {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
	transform-origin: 50% 92%;
	animation: spicetify-splash-sway var(--_motion) ease-in-out infinite;
}
.spicetify-splash__mark path { fill: var(--splash-logo-fill, url(#spicetify-splash-gradient)); }
.spicetify-splash__mark-start { stop-color: var(--splash-logo-start, #f68c28); }
.spicetify-splash__mark-end { stop-color: var(--splash-logo-end, #e8473c); }
.spicetify-splash[data-image="custom"] .spicetify-splash__logo {
	width: var(--_image-size);
	max-width: 60vw;
	height: auto;
	max-height: 40vh;
	aspect-ratio: auto;
}
.spicetify-splash[data-image="custom"] .spicetify-splash__logo > * {
	height: auto;
	max-height: 40vh;
	transform-origin: center;
	animation-name: spicetify-splash-breathe;
}

.spicetify-splash__bar {
	position: relative;
	width: var(--splash-bar-width, 64px);
	height: var(--splash-bar-height, 3px);
	margin-top: 40px;
	border-radius: 999px;
	overflow: hidden;
	background: color-mix(in srgb, var(--_foreground) 12%, transparent);
}
.spicetify-splash__bar::after {
	content: "";
	position: absolute;
	inset: 0 auto 0 0;
	width: 40%;
	border-radius: inherit;
	background: var(--splash-bar-color, var(--_accent));
	animation: spicetify-splash-bar 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}
.spicetify-splash__caption {
	margin: 16px 0 0;
	font-size: 12px;
	font-weight: 500;
	letter-spacing: 0.06em;
	color: color-mix(in srgb, var(--_foreground) 60%, transparent);
}
.spicetify-splash__caption::after { content: var(--splash-caption, ""); }

.spicetify-splash[data-stage="leaving"] .spicetify-splash__surface { opacity: 0; }
.spicetify-splash[data-stage="leaving"] .spicetify-splash__content { scale: 1.06; }

@keyframes spicetify-splash-enter {
	from { opacity: 0; translate: 0 8px; }
}
@keyframes spicetify-splash-sway {
	0%, 100% { transform: rotate(-1.5deg) scale(1, 0.98); }
	50% { transform: rotate(1.5deg) scale(1, 1.02); }
}
@keyframes spicetify-splash-breathe {
	0%, 100% { transform: scale(0.97); opacity: 0.9; }
	50% { transform: scale(1); opacity: 1; }
}
@keyframes spicetify-splash-drift {
	from { transform: translate(-4%, -3%) scale(0.92); }
	to { transform: translate(4%, 3%) scale(1.08); }
}
@keyframes spicetify-splash-bar {
	from { transform: translateX(-100%); }
	to { transform: translateX(250%); }
}

@media (prefers-reduced-motion: reduce) {
	.spicetify-splash *, .spicetify-splash *::before, .spicetify-splash *::after {
		animation: none !important;
		transition: none !important;
	}
	.spicetify-splash__bar::after { width: 100%; opacity: 0.5; }
}
}
`;
