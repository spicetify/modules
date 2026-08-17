/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { client, createRegistrar, React, type ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { SettingsRow, Toggle } from "/modules/stdlib/lib/primitives.js";

import {
	createDebouncedReassertion,
	createSharedStateReconciler,
	HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE,
	resolveHiddenState,
	type SharedReconcilerState,
	STORAGE_KEY,
} from "./logic.ts";

const isRequired = () => document.documentElement.hasAttribute(HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE);
const isEnabled = () => resolveHiddenState(localStorage.getItem(STORAGE_KEY), isRequired());

// The DesktopUpdateUi service is the shell's own bridge for the native window
// chrome; showButtons:false removes the macOS traffic lights (and the shell's
// window buttons on other platforms, where the shell draws them).
const setButtonsVisible = async (visible: boolean) => {
	const updateUiClient = client.platform?.ControlMessageAPI?._updateUiClient;
	await updateUiClient?.setButtonsVisibility?.({ showButtons: visible });
};

// The client parks an empty 52px div at the head of the nav's history buttons
// so the macOS traffic lights have somewhere to sit. Hiding the lights leaves
// it behind as a hole at the top left, with the back and forward buttons
// starting 106px in from the edge for no reason anyone can see.
//
// Keyed on :empty and on the css-map name of the wrapper rather than the
// spacer's own class, which is a per-build hash. If the client ever puts
// something in that slot the rule stops matching instead of crushing it.
const SPACER_CSS = `.spotify__os--is-macos .main-globalNav-historyButtonsWrapper > div:first-child:empty {
	width: 0 !important;
}`;

const SPACER_STYLE_ID = "spicetify-hide-window-controls-spacer";
const SHARED_RECONCILER_KEY = "__spicetifyHideWindowControlsReconciler";

const setSpacerCollapsed = (collapsed: boolean) => {
	const existing = document.getElementById(SPACER_STYLE_ID);
	if (!collapsed) {
		existing?.remove();
		return;
	}
	if (existing) return;
	const style = document.createElement("style");
	style.id = SPACER_STYLE_ID;
	style.textContent = SPACER_CSS;
	document.head.appendChild(style);
};

// --global-nav-margin-top is the text theme's documented hook for the space
// it reserves under the traffic lights; unused by other themes, so setting
// it is harmless there.
const apply = async (hidden: boolean) => {
	await setButtonsVisible(!hidden);
	const style = document.documentElement.style;
	if (hidden) style.setProperty("--global-nav-margin-top", "0px");
	else style.removeProperty("--global-nav-margin-top");
	setSpacerCollapsed(hidden);
};

export default async function (ctx: ModuleRuntimeContext) {
	const runtime = globalThis as typeof globalThis & {
		[SHARED_RECONCILER_KEY]?: SharedReconcilerState;
	};
	const shared = (runtime[SHARED_RECONCILER_KEY] ??= {
		generation: 0,
		desired: false,
		transition: Promise.resolve(),
	});
	const reconciler = createSharedStateReconciler(apply, shared);

	const RequirementLockedToggle = () => {
		const id = React.useId();
		const [state, setState] = React.useState(() => ({ required: isRequired(), hidden: isEnabled() }));

		React.useEffect(() => {
			const sync = () => setState({ required: isRequired(), hidden: isEnabled() });
			const observer = new MutationObserver(sync);
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: [HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE],
			});
			sync();
			return () => observer.disconnect();
		}, []);

		return (
			<fieldset
				className="spicetify-hide-window-controls-setting"
				disabled={state.required}
				title={state.required ? "Required by the active theme" : ""}
				style={{ display: "contents" }}
			>
				<SettingsRow label="Hide window controls" htmlFor={id}>
					<Toggle
						id={id}
						value={state.hidden}
						onChange={(hidden) => {
							if (isRequired()) return;
							localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
							setState({ required: false, hidden });
							void reconciler
								.request(hidden)
								.catch((error) =>
									console.warn("[hide-window-controls] could not update the window state", error),
								);
						}}
					/>
				</SettingsRow>
			</fieldset>
		);
	};

	const registrar = createRegistrar(ctx);
	registrar.register("settingsRow", <RequirementLockedToggle />);

	const syncRequirement = () => {
		return reconciler.request(isEnabled());
	};
	const syncRequirementSafely = () => {
		void syncRequirement().catch((error) =>
			console.warn("[hide-window-controls] could not update the required window state", error),
		);
	};
	const requirementObserver = new MutationObserver(syncRequirementSafely);
	requirementObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: [HIDE_WINDOW_CONTROLS_REQUIRED_ATTRIBUTE],
	});

	// Desktop shells may rebuild their native chrome after a window-state
	// transition without changing any web state. Reassert the desired state at
	// those boundaries; debouncing keeps resize drags to one bridge call.
	const reassertion = createDebouncedReassertion(
		syncRequirement,
		(callback) => window.setTimeout(callback, 100),
		(id) => window.clearTimeout(id),
		(error) => console.warn("[hide-window-controls] could not reassert the window state", error),
	);
	const reassert = () => reassertion.trigger();
	for (const event of ["focus", "pageshow", "resize"] as const) window.addEventListener(event, reassert);
	for (const event of ["fullscreenchange", "visibilitychange"] as const) document.addEventListener(event, reassert);

	ctx.defer(async () => {
		reassertion.stop();
		for (const event of ["focus", "pageshow", "resize"] as const) window.removeEventListener(event, reassert);
		for (const event of ["fullscreenchange", "visibilitychange"] as const)
			document.removeEventListener(event, reassert);
		requirementObserver.disconnect();
		await reconciler.stop(false);
	});
	try {
		await syncRequirement();
	} catch (error) {
		console.warn("[hide-window-controls] could not apply the initial window state", error);
	}
}
