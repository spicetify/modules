/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createRegistrar, React } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import {
	Button,
	SettingsActions,
	SettingsLabel,
	SettingsRow,
	SettingsSection,
} from "/modules/stdlib/lib/primitives.js";
import { getSplashImage, readSplashImage, resetSplashImage, saveSplashImage } from "./image.ts";
import { showSplash } from "./splash.ts";
import { getCustomCss, saveCustomCss } from "./theme.ts";

const CSS_PLACEHOLDER = `.spicetify-splash {
  --splash-accent: #cba6f7;
  --splash-logo-fill: var(--splash-accent);
  --splash-caption: "warming up";
}`;

let preview: ReturnType<typeof showSplash> | undefined;

function SplashSettings() {
	const input = React.useRef<HTMLInputElement>(null);
	const [custom, setCustom] = React.useState(() => getSplashImage() !== null);
	const [savedCss, setSavedCss] = React.useState(getCustomCss);
	const [css, setCss] = React.useState(savedCss);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState("");
	const choose = async (file: File) => {
		setBusy(true);
		setError("");
		try {
			const source = await readSplashImage(file);
			const image = new Image();
			image.src = source;
			await image.decode();
			saveSplashImage(source);
			setCustom(true);
		} catch (error) {
			console.error("[spicetify-splash] Could not save the selected image.", error);
			setError(
				error instanceof Error && error.name === "Error"
					? error.message
					: "The image could not be saved. Choose another file.",
			);
		} finally {
			setBusy(false);
			if (input.current) input.current.value = "";
		}
	};
	const saveCss = () => {
		try {
			saveCustomCss(css);
			setSavedCss(css);
			setError("");
		} catch (error) {
			console.error("[spicetify-splash] Could not save the custom CSS.", error);
			setError(
				error instanceof Error && error.name === "Error"
					? error.message
					: "The CSS could not be saved. Try again.",
			);
		}
	};
	return (
		<SettingsSection title="Spicetify Splash">
			<SettingsRow
				label={
					<SettingsLabel
						label="Preview"
						description="Shows the splash with your image and CSS, including unsaved CSS. Click it or press Escape to close."
					/>
				}
			>
				<SettingsActions>
					<Button
						variant="secondary"
						onClick={() => {
							preview?.dispose();
							preview = showSplash({ preview: true, css });
						}}
					>
						Preview splash
					</Button>
				</SettingsActions>
			</SettingsRow>
			<SettingsRow
				label={
					<SettingsLabel
						label="Splash image"
						description={`${custom ? "Custom image saved." : "Using the Spicetify logo."} Changes appear next startup. Choose PNG, JPEG, WebP, GIF, or SVG up to 512 KB.`}
					/>
				}
			>
				<SettingsActions>
					<Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
						{busy ? "Saving…" : "Choose image…"}
					</Button>
					<Button
						variant="secondary"
						disabled={busy || !custom}
						onClick={() => {
							try {
								resetSplashImage();
								setCustom(false);
								setError("");
							} catch (error) {
								console.error("[spicetify-splash] Could not reset the splash image.", error);
								setError("The image could not be reset. Try again.");
							}
						}}
					>
						Reset image
					</Button>
					<input
						ref={input}
						type="file"
						hidden
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) void choose(file);
						}}
					/>
				</SettingsActions>
			</SettingsRow>
			<SettingsRow
				label={
					<SettingsLabel
						label="Custom CSS"
						description="Restyle the splash with --splash-* variables or .spicetify-splash selectors. Theme rules for the splash also apply from the first frame after one startup."
					/>
				}
			>
				<SettingsActions>
					<Button variant="secondary" disabled={css === savedCss} onClick={saveCss}>
						Save CSS
					</Button>
				</SettingsActions>
			</SettingsRow>
			<textarea
				className="spicetify-splash-settings__css"
				aria-label="Custom splash CSS"
				spellCheck={false}
				placeholder={CSS_PLACEHOLDER}
				value={css}
				rows={8}
				onChange={(event) => setCss(event.target.value)}
				style={{
					width: "100%",
					boxSizing: "border-box",
					padding: "12px",
					resize: "vertical",
					font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
					color: "var(--spice-text, inherit)",
					background: "var(--spice-card, rgba(255, 255, 255, 0.07))",
					border: "1px solid var(--spice-misc, rgba(255, 255, 255, 0.1))",
					borderRadius: "6px",
				}}
			/>
			{error ? <p role="alert">{error}</p> : null}
		</SettingsSection>
	);
}

export default function (ctx: ModuleRuntimeContext) {
	ctx.defer(() => {
		preview?.dispose();
		preview = undefined;
	});
	createRegistrar(ctx).register("settingsSection", <SplashSettings />);
}
