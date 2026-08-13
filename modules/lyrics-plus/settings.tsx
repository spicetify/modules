/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-nocheck — extracted verbatim from the untyped lyrics-plus port; see the
// header note in mod.tsx.

// Settings.js — contextual appearance controls plus provider settings shared
// with the standalone Spicetify Settings page.

import { React as react } from "/modules/stdlib/src/expose/React.ts";
import {
	IconButton,
	SettingsButtonRow,
	SettingsProviderRow,
	SettingsTextInputRow,
	Toggle,
} from "/modules/stdlib/lib/primitives.js";
import {
	SETTINGS_HELP_TEXT_CLASS,
	SETTINGS_ROW_TEXT_CLASS,
	SETTINGS_SECTION_SUBHEADING_CLASS,
} from "/modules/stdlib/lib/primitives-classes.js";
import { APP_NAME, CONFIG, fontSizeLimit, thresholdSizeLimit } from "./config.ts";
import { isMusixmatchTokenValid, musixmatchTokenListeners, setMusixmatchTokenValid } from "./providers/musixmatch.ts";
import * as sharedCallbacks from "./shared-callbacks.ts";

const { useState, useEffect, useCallback, useId } = react;

function useMusixmatchTokenValid() {
	const [valid, setValid] = useState(isMusixmatchTokenValid());
	useEffect(() => {
		const listener = (v) => setValid(v);
		musixmatchTokenListeners.add(listener);
		return () => musixmatchTokenListeners.delete(listener);
	}, []);
	return valid;
}

export const MusixmatchTokenSetting = ({ onTokenChange }) => {
	const [token, setToken] = useState(CONFIG.providers.musixmatch.token);
	const [buttonText, setButtonText] = useState("Refresh token");
	const setTokenCallback = useCallback(
		(value) => {
			setToken(value);
			onTokenChange(value);
			setMusixmatchTokenValid(true);
		},
		[onTokenChange],
	);

	useEffect(() => {
		if (buttonText === "Refreshing token...") {
			Spicetify.CosmosAsync.get(
				"https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0",
				null,
				{
					Host: "apic-appmobile.musixmatch.com",
					authority: "apic-appmobile.musixmatch.com",
					"X-Cookie": "x-mxm-token-guid=",
					"x-mxm-app-version": "10.1.1",
					"X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
					"Accept-Language": "en-US,en;q=0.9",
					Connection: "keep-alive",
					Accept: "application/json",
				},
			)
				.then(({ message: response }) => {
					if (response.header.status_code === 200 && response.body.user_token) {
						setTokenCallback(response.body.user_token);
						setButtonText("Token refreshed");
					} else if (response.header.status_code === 401) {
						setButtonText("Too many attempts");
					} else {
						setButtonText("Failed to refresh token");
						console.error("Failed to refresh token", response);
					}
				})
				.catch((error) => {
					setButtonText("Failed to refresh token");
					console.error("Failed to refresh token", error);
				});
		}
	}, [buttonText]);

	return react.createElement(SettingsTextInputRow, {
		label: "Musixmatch token",
		description: "Used by the Musixmatch provider. If lyrics stop loading, refresh the token.",
		value: token,
		placeholder: "Musixmatch user token",
		ariaLabel: "Musixmatch token",
		onInput: setTokenCallback,
		actionLabel: buttonText,
		actionDisabled: buttonText !== "Refresh token",
		onAction: () => setButtonText("Refreshing token..."),
	});
};

export const ConfigButton = ({ name, text, onChange = () => {} }) => {
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: `col description ${SETTINGS_ROW_TEXT_CLASS}`,
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"button",
				{
					className: "btn",
					onClick: onChange,
				},
				text,
			),
		),
	);
};

export const ConfigSlider = ({ name, defaultValue, onChange = () => {} }) => {
	const id = useId();
	const [active, setActive] = useState(defaultValue);

	useEffect(() => {
		setActive(defaultValue);
	}, [defaultValue]);

	const toggleState = useCallback(
		(state) => {
			setActive(state);
			onChange(state);
		},
		[onChange],
	);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: `col description ${SETTINGS_ROW_TEXT_CLASS}`,
				htmlFor: id,
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(Toggle, {
				id,
				ariaLabel: name,
				value: active,
				onChange: toggleState,
			}),
		),
	);
};

export const ConfigSelection = ({ name, defaultValue, options, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			let value = event.target.value;
			if (!Number.isNaN(Number(value))) {
				value = Number.parseInt(value);
			}
			setValue(value);
			onChange(value);
		},
		[value, options],
	);

	useEffect(() => {
		setValue(defaultValue);
	}, [defaultValue]);

	if (!Object.keys(options).length) return null;

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: `col description ${SETTINGS_ROW_TEXT_CLASS}`,
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"select",
				{
					className: "main-dropDown-dropDown",
					value,
					onChange: setValueCallback,
				},
				Object.keys(options).map((item) =>
					react.createElement(
						"option",
						{
							value: item,
						},
						options[item],
					),
				),
			),
		),
	);
};

export const ConfigInput = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			const value = event.target.value;
			setValue(value);
			onChange(value);
		},
		[value],
	);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: `col description ${SETTINGS_ROW_TEXT_CLASS}`,
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onChange: setValueCallback,
			}),
		),
	);
};

export const ConfigAdjust = ({ name, defaultValue, step, min, max, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	function adjust(dir) {
		let temp = value + dir * step;
		if (temp < min) {
			temp = min;
		} else if (temp > max) {
			temp = max;
		}
		setValue(temp);
		onChange(temp);
	}
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: `col description ${SETTINGS_ROW_TEXT_CLASS}`,
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				IconButton,
				{
					ariaLabel: `Decrease ${name}`,
					onClick: () => adjust(-1),
					disabled: value === min,
				},
				"−",
			),
			react.createElement(
				"p",
				{
					className: "adjust-value",
				},
				value,
			),
			react.createElement(
				IconButton,
				{
					ariaLabel: `Increase ${name}`,
					onClick: () => adjust(1),
					disabled: value === max,
				},
				"+",
			),
		),
	);
};

export const ConfigHotkey = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);
	const [trap] = useState(new Spicetify.Mousetrap());

	function record() {
		trap.handleKey = (character, modifiers, e) => {
			if (e.type === "keydown") {
				const sequence = [...new Set([...modifiers, character])];
				if (sequence.length === 1 && sequence[0] === "esc") {
					onChange("");
					setValue("");
					return;
				}
				setValue(sequence.join("+"));
			}
		};
	}

	function finishRecord() {
		trap.handleKey = () => {};
		onChange(value);
	}

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: `col description ${SETTINGS_ROW_TEXT_CLASS}`,
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onFocus: record,
				onBlur: finishRecord,
			}),
		),
	);
};

export const ServiceOption = ({ item, onToggle, onSwap, index, total }) => {
	const [active, setActive] = useState(item.on);
	const tokenValid = useMusixmatchTokenValid();
	const musixmatchInvalid = item.name === "musixmatch" && !tokenValid;

	const toggleActive = useCallback(
		(state) => {
			setActive(state);
			onToggle(item.name, state);
		},
		[item.name, onToggle],
	);
	const toggleDisabled = musixmatchInvalid;

	return react.createElement(SettingsProviderRow, {
		label: item.name.replace(/^./, (character) => character.toUpperCase()),
		description: item.desc,
		value: active,
		disabled: toggleDisabled,
		disabledReason: musixmatchInvalid
			? "Musixmatch token is invalid and could not be refreshed automatically. Refresh the token or paste your own to re-enable it."
			: undefined,
		index,
		total,
		onMove: (direction) => onSwap(item.name, direction),
		onChange: toggleActive,
	});
};

export const ServiceList = ({ itemsList, onListChange = () => {}, onToggle = () => {} }) => {
	const [items, setItems] = useState(itemsList);
	const maxIndex = items.length - 1;

	const onSwap = useCallback(
		(name, direction) => {
			const curPos = items.findIndex((val) => val === name);
			const newPos = curPos + direction;
			[items[curPos], items[newPos]] = [items[newPos], items[curPos]];
			onListChange(items);
			setItems([...items]);
		},
		[items],
	);

	return items.map((key, index) => {
		const item = CONFIG.providers[key];
		item.name = key;
		return react.createElement(ServiceOption, {
			item,
			key,
			index,
			total: maxIndex + 1,
			onSwap,
			onToggle,
		});
	});
};

export const OptionList = ({ type, items, onChange }) => {
	const [itemList, setItemList] = useState(items);
	const [, forceUpdate] = useState();

	useEffect(() => {
		if (!type) return;

		const eventListener = (event) => {
			if (event.detail?.type !== type) return;
			setItemList(event.detail.items);
		};
		document.addEventListener("lyrics-plus", eventListener);

		return () => document.removeEventListener("lyrics-plus", eventListener);
	}, []);

	return itemList.map((item) => {
		if (!item || (item.when && !item.when())) {
			return;
		}

		const onChangeItem = item.onChange || onChange;

		return react.createElement(
			"div",
			null,
			react.createElement(item.type, {
				...item,
				name: item.desc,
				defaultValue: CONFIG.visual[item.key],
				onChange: (value) => {
					onChangeItem(item.key, value);
					forceUpdate({});
				},
			}),
			item.info &&
				react.createElement("span", {
					className: SETTINGS_HELP_TEXT_CLASS,
					dangerouslySetInnerHTML: {
						__html: item.info,
					},
				}),
		);
	});
};

export function LyricsPlusAppearanceSettings() {
	return react.createElement(
		"div",
		{
			id: `${APP_NAME}-appearance-config-container`,
		},
		react.createElement(OptionList, {
			items: [
				{
					desc: "Playbar button",
					key: "playbar-button",
					info: "Replace Spotify's lyrics button with Lyrics Plus.",
					type: ConfigSlider,
				},
				{
					desc: "Global delay",
					info: "Offset (in ms) across all tracks.",
					key: "global-delay",
					type: ConfigAdjust,
					min: -10000,
					max: 10000,
					step: 250,
				},
				{
					desc: "Font size",
					info: "(or Ctrl + Mouse scroll in main app)",
					key: "font-size",
					type: ConfigAdjust,
					min: fontSizeLimit.min,
					max: fontSizeLimit.max,
					step: fontSizeLimit.step,
				},
				{
					desc: "Alignment",
					key: "alignment",
					type: ConfigSelection,
					options: {
						left: "Left",
						center: "Center",
						right: "Right",
					},
				},
				{
					desc: "Fullscreen hotkey",
					key: "fullscreen-key",
					type: ConfigHotkey,
				},
				{
					desc: "Compact synced: Lines to show before",
					key: "lines-before",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Lines to show after",
					key: "lines-after",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Fade-out blur",
					key: "fade-blur",
					type: ConfigSlider,
				},
				{
					desc: "Noise overlay",
					key: "noise",
					type: ConfigSlider,
				},
				{
					desc: "Colorful background",
					key: "colorful",
					type: ConfigSlider,
				},
				{
					desc: "Background color",
					key: "background-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Active text color",
					key: "active-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Inactive text color",
					key: "inactive-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Highlight text background",
					key: "highlight-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Text convertion: Japanese Detection threshold (Advanced)",
					info: "Checks if whenever Kana is dominant in lyrics. If the result passes the threshold, it's most likely Japanese, and vice versa. This setting is in percentage.",
					key: "ja-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
				{
					desc: "Text convertion: Traditional-Simplified Detection threshold (Advanced)",
					info: "Checks if whenever Traditional or Simplified is dominant in lyrics. If the result passes the threshold, it's most likely Simplified, and vice versa. This setting is in percentage.",
					key: "hans-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
			],
			onChange: (name, value) => {
				CONFIG.visual[name] = value;
				localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
				sharedCallbacks.lyricContainerUpdate?.();

				const configChange = new CustomEvent("lyrics-plus", {
					detail: {
						type: "config",
						name: name,
						value: value,
					},
				});
				window.dispatchEvent(configChange);
			},
		}),
	);
}

export function openLyricsPlusAppearanceSettings() {
	Spicetify.PopupModal.display({
		title: "Lyrics Plus appearance",
		content: react.createElement(LyricsPlusAppearanceSettings),
		isLarge: true,
	});
}

export function LyricsPlusSettings() {
	const updateMusixmatchToken = useCallback((value) => {
		CONFIG.providers.musixmatch.token = value;
		localStorage.setItem(`${APP_NAME}:provider:musixmatch:token`, value);
		sharedCallbacks.reloadLyrics?.();
	}, []);
	return react.createElement(
		"div",
		{
			className: "lyrics-plus-settings",
		},
		react.createElement(SettingsButtonRow, {
			label: "Lyrics cache",
			description:
				"Loaded lyrics are cached in memory for faster reloading. Press this button to clear the cached lyrics from memory without restarting Spotify.",
			buttonLabel: "Clear cached lyrics",
			onClick: () => sharedCallbacks.reloadLyrics?.(),
		}),
		react.createElement("h3", { className: SETTINGS_SECTION_SUBHEADING_CLASS }, "Providers"),
		react.createElement(ServiceList, {
			itemsList: CONFIG.providersOrder,
			onListChange: (list) => {
				CONFIG.providersOrder = list;
				localStorage.setItem(`${APP_NAME}:services-order`, JSON.stringify(list));
				sharedCallbacks.reloadLyrics?.();
			},
			onToggle: (name, value) => {
				CONFIG.providers[name].on = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:on`, value);
				sharedCallbacks.reloadLyrics?.();
			},
		}),
		react.createElement(MusixmatchTokenSetting, { onTokenChange: updateMusixmatchToken }),
	);
}
