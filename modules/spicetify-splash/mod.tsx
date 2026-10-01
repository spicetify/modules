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
import { LOGO } from "./logo.ts";

function SplashSettings() {
	const input = React.useRef<HTMLInputElement>(null);
	const [custom, setCustom] = React.useState(getSplashImage() !== LOGO);
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
	return (
		<SettingsSection title="Spicetify Splash">
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
			{error ? <p role="alert">{error}</p> : null}
		</SettingsSection>
	);
}

export default function (ctx: ModuleRuntimeContext) {
	createRegistrar(ctx).register("settingsSection", <SplashSettings />);
}
