/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-nocheck — extracted verbatim from the untyped lyrics-plus port; see the
// header note in mod.tsx.

// Settings.js — contextual appearance controls plus provider settings shared
// with the standalone Spicetify Settings page.

import { client, displayModal, React as react } from "/modules/stdlib/mod.ts";
import {
	IconButton,
	Select,
	SettingsActions,
	SettingsButtonRow,
	SettingsLabel,
	SettingsProviderRow,
	SettingsRow,
	SettingsSection,
	SettingsTextInputRow,
	TextInput,
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
			client.cosmos
				.get("https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0", null, {
					Host: "apic-appmobile.musixmatch.com",
					authority: "apic-appmobile.musixmatch.com",
					"X-Cookie": "x-mxm-token-guid=",
					"x-mxm-app-version": "10.1.1",
					"X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
					"Accept-Language": "en-US,en;q=0.9",
					Connection: "keep-alive",
					Accept: "application/json",
				})
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
	const [trap] = useState(() => new client.mousetrap());

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

const AppearanceToggleRow = ({ name, description, defaultValue, onChange }) => {
	const id = useId();
	const [value, setValue] = useState(defaultValue);
	useEffect(() => setValue(defaultValue), [defaultValue]);
	return (
		<SettingsRow label={<SettingsLabel label={name} description={description} />} htmlFor={id}>
			<Toggle
				id={id}
				ariaLabel={name}
				value={value}
				onChange={(nextValue) => {
					setValue(nextValue);
					onChange(nextValue);
				}}
			/>
		</SettingsRow>
	);
};

const AppearanceAdjustRow = ({ name, description, defaultValue, step, min, max, onChange }) => {
	const [value, setValue] = useState(defaultValue);
	useEffect(() => setValue(defaultValue), [defaultValue]);
	const adjust = (direction) => {
		const nextValue = Math.max(min, Math.min(max, value + direction * step));
		setValue(nextValue);
		onChange(nextValue);
	};
	return (
		<SettingsRow label={<SettingsLabel label={name} description={description} />}>
			<SettingsActions>
				<IconButton ariaLabel={`Decrease ${name}`} disabled={value === min} onClick={() => adjust(-1)}>
					−
				</IconButton>
				<output className="lyrics-plus-appearance-value" aria-live="polite">
					{value}
				</output>
				<IconButton ariaLabel={`Increase ${name}`} disabled={value === max} onClick={() => adjust(1)}>
					+
				</IconButton>
			</SettingsActions>
		</SettingsRow>
	);
};

const AppearanceSelectRow = ({ name, description, defaultValue, options, onChange }) => {
	const [value, setValue] = useState(String(defaultValue));
	useEffect(() => setValue(String(defaultValue)), [defaultValue]);
	const normalizedOptions = Object.entries(options).map(([optionValue, label]) => ({
		value: optionValue,
		label: String(label),
	}));
	return (
		<SettingsRow label={<SettingsLabel label={name} description={description} />}>
			<Select
				ariaLabel={name}
				options={normalizedOptions}
				value={value}
				onChange={(nextValue) => {
					setValue(nextValue);
					onChange(Number.isNaN(Number(nextValue)) ? nextValue : Number.parseInt(nextValue));
				}}
			/>
		</SettingsRow>
	);
};

const AppearanceTextRow = ({ name, description, defaultValue, onChange }) => {
	const [value, setValue] = useState(defaultValue);
	useEffect(() => setValue(defaultValue), [defaultValue]);
	return (
		<SettingsTextInputRow
			label={name}
			description={description}
			value={value}
			ariaLabel={name}
			onInput={(nextValue) => {
				setValue(nextValue);
				onChange(nextValue);
			}}
		/>
	);
};

const AppearanceHotkeyRow = ({ name, description, defaultValue, onChange }) => {
	const [value, setValue] = useState(defaultValue);
	const [trap] = useState(() => new client.mousetrap());
	useEffect(() => setValue(defaultValue), [defaultValue]);
	useEffect(() => () => trap.reset?.(), [trap]);
	const record = () => {
		trap.handleKey = (character, modifiers, event) => {
			if (event.type !== "keydown") return;
			const sequence = [...new Set([...modifiers, character])];
			if (sequence.length === 1 && sequence[0] === "esc") {
				setValue("");
				return;
			}
			setValue(sequence.join("+"));
		};
	};
	const finish = () => {
		trap.handleKey = () => {};
		onChange(value);
	};
	return (
		<SettingsRow label={<SettingsLabel label={name} description={description} />}>
			<TextInput ariaLabel={name} value={value} readOnly onFocus={record} onBlur={finish} />
		</SettingsRow>
	);
};

const AppearanceOptions = ({ items, onChange }) =>
	items
		.filter((item) => !item.when || item.when())
		.map((item) =>
			react.createElement(item.type, {
				...item,
				key: item.key,
				name: item.desc,
				description: item.info,
				defaultValue: CONFIG.visual[item.key],
				onChange: (value) => onChange(item.key, value),
			}),
		);

export function LyricsPlusAppearanceSettings() {
	const [, refresh] = useState(0);
	const onChange = (name, value) => {
		CONFIG.visual[name] = value;
		localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
		sharedCallbacks.lyricContainerUpdate?.();
		window.dispatchEvent(new CustomEvent("lyrics-plus", { detail: { type: "config", name, value } }));
		refresh((revision) => revision + 1);
	};
	return (
		<div id={`${APP_NAME}-appearance-config-container`} className="lyrics-plus-appearance-settings">
			<SettingsSection title="Playback">
				<AppearanceOptions
					items={[
						{
							desc: "Playbar button",
							key: "playbar-button",
							info: "Replace Spotify's lyrics button with Lyrics Plus.",
							type: AppearanceToggleRow,
						},
						{
							desc: "Global delay",
							info: "Offset every lyric line across all tracks, in milliseconds.",
							key: "global-delay",
							type: AppearanceAdjustRow,
							min: -10000,
							max: 10000,
							step: 250,
						},
						{
							desc: "Font size",
							info: "You can also hold Ctrl and scroll in the main lyrics view.",
							key: "font-size",
							type: AppearanceAdjustRow,
							min: fontSizeLimit.min,
							max: fontSizeLimit.max,
							step: fontSizeLimit.step,
						},
						{
							desc: "Alignment",
							key: "alignment",
							type: AppearanceSelectRow,
							options: {
								left: "Left",
								center: "Center",
								right: "Right",
							},
						},
						{
							desc: "Fullscreen hotkey",
							info: "Focus the field, then press the shortcut you want to use.",
							key: "fullscreen-key",
							type: AppearanceHotkeyRow,
						},
					]}
					onChange={onChange}
				/>
			</SettingsSection>
			<SettingsSection title="Compact lyrics">
				<AppearanceOptions
					items={[
						{
							desc: "Lines before",
							key: "lines-before",
							type: AppearanceSelectRow,
							options: [0, 1, 2, 3, 4],
						},
						{
							desc: "Lines after",
							key: "lines-after",
							type: AppearanceSelectRow,
							options: [0, 1, 2, 3, 4],
						},
						{
							desc: "Fade-out blur",
							info: "Softly blur lines as they leave the compact view.",
							key: "fade-blur",
							type: AppearanceToggleRow,
						},
					]}
					onChange={onChange}
				/>
			</SettingsSection>
			<SettingsSection title="Backdrop">
				<AppearanceOptions
					items={[
						{
							desc: "Noise overlay",
							info: "Add subtle texture behind the lyrics.",
							key: "noise",
							type: AppearanceToggleRow,
						},
						{
							desc: "Colorful background",
							info: "Derive the backdrop and text colors from the current artwork.",
							key: "colorful",
							type: AppearanceToggleRow,
						},
						{
							desc: "Background color",
							key: "background-color",
							type: AppearanceTextRow,
							when: () => !CONFIG.visual.colorful,
						},
						{
							desc: "Active text color",
							key: "active-color",
							type: AppearanceTextRow,
							when: () => !CONFIG.visual.colorful,
						},
						{
							desc: "Inactive text color",
							key: "inactive-color",
							type: AppearanceTextRow,
							when: () => !CONFIG.visual.colorful,
						},
						{
							desc: "Highlight text background",
							key: "highlight-color",
							type: AppearanceTextRow,
							when: () => !CONFIG.visual.colorful,
						},
					]}
					onChange={onChange}
				/>
			</SettingsSection>
			<SettingsSection title="Advanced text detection">
				<AppearanceOptions
					items={[
						{
							desc: "Japanese threshold",
							info: "Kana percentage used to distinguish Japanese lyrics from Chinese lyrics.",
							key: "ja-detect-threshold",
							type: AppearanceAdjustRow,
							min: thresholdSizeLimit.min,
							max: thresholdSizeLimit.max,
							step: thresholdSizeLimit.step,
						},
						{
							desc: "Simplified Chinese threshold",
							info: "Character percentage used to distinguish Simplified from Traditional Chinese.",
							key: "hans-detect-threshold",
							type: AppearanceAdjustRow,
							min: thresholdSizeLimit.min,
							max: thresholdSizeLimit.max,
							step: thresholdSizeLimit.step,
						},
					]}
					onChange={onChange}
				/>
			</SettingsSection>
		</div>
	);
}

export function openLyricsPlusAppearanceSettings() {
	displayModal({
		title: "Lyrics Plus appearance",
		content: react.createElement(LyricsPlusAppearanceSettings),
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
