/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { Button, Select, SettingsRow, SettingsSection, TextInput } from "../../lib/primitives.tsx";
import { SETTINGS_HELP_TEXT_CLASS } from "../../lib/primitives-classes.ts";

const MODE_OPTIONS = [
	{ value: "automatic", label: "Automatic" },
	{ value: "custom", label: "Custom" },
] as const;

const SettingsLabel = (props: { title: string; description: string }) => (
	<span className="spicetify-settings-label-copy">
		<span>{props.title}</span>
		<span className={SETTINGS_HELP_TEXT_CLASS}>{props.description}</span>
	</span>
);

const CorsProxySettingsAvailable = (props: { api: typeof Spicetify.CORSProxy }) => {
	const { api } = props;
	const [initial] = React.useState(() => api.configuration());
	const [mode, setMode] = React.useState<Spicetify.CORSProxy.Mode>(initial.mode);
	const [template, setTemplate] = React.useState(initial.template ?? "");
	const [message, setMessage] = React.useState("");
	const valid = api.isValidTemplate(template);
	const [daemonTemplate, hostedTemplate] = initial.automaticTemplates;

	const changeMode = (next: Spicetify.CORSProxy.Mode) => {
		setMode(next);
		setMessage("");
		if (next === "automatic") {
			api.configure({ mode: "automatic" });
			setMessage("Automatic routing is active.");
		}
	};

	const applyCustom = () => {
		try {
			api.configure({ mode: "custom", template });
			setMessage("Custom proxy is active.");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "The custom proxy template is invalid.");
		}
	};

	return (
		<SettingsSection title="CORS Proxy">
			<SettingsRow
				label={
					<SettingsLabel
						title="Routing"
						description="Automatic tries the authenticated local daemon first, then Spicetify's hosted proxy."
					/>
				}
			>
				<Select ariaLabel="CORS proxy routing" options={MODE_OPTIONS} value={mode} onChange={changeMode} />
			</SettingsRow>
			{mode === "custom" ? (
				<SettingsRow
					label={
						<SettingsLabel
							title="Custom template"
							description={
								'Use an absolute URL containing "{url}". A custom template replaces automatic fallback.'
							}
						/>
					}
				>
					<div className="spicetify-cors-proxy-controls">
						<TextInput
							ariaLabel="Custom CORS proxy template"
							placeholder="https://proxy.example/{url}"
							value={template}
							onInput={setTemplate}
						/>
						<Button variant="secondary" disabled={!valid} onClick={applyCustom}>
							Apply
						</Button>
					</div>
				</SettingsRow>
			) : null}
			<span className={SETTINGS_HELP_TEXT_CLASS}>
				{message || `Automatic chain: ${daemonTemplate} → ${hostedTemplate}`}
			</span>
		</SettingsSection>
	);
};

export const CorsProxySettings = () => {
	const api = Spicetify.CORSProxy;
	if (
		typeof api?.configuration !== "function" ||
		typeof api?.configure !== "function" ||
		typeof api?.isValidTemplate !== "function"
	) {
		return null;
	}
	return <CorsProxySettingsAvailable api={api} />;
};
