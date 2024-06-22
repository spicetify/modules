/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../src/expose/React.ts";
import { future, SettingsSection, SettingsSectionTitle } from "../src/expose/SettingsSection.ts";
import SettingsSectionRegistry from "../src/registers/settingsSection.ts";
import { UI } from "../src/webpack/ComponentLibrary.ts";
import { Settings as S, SettingsToggle } from "../src/webpack/ReactComponents.ts";
import SettingsButton from "./components/SettingsButton.tsx";
import type { Module } from "/hooks/index.ts";

type Task<A> = (() => Awaited<A>) | (() => Promise<Awaited<A>>);

type OmitType<A> = Omit<A, "type">;

export enum FieldType {
	BUTTON = "button",
	TOGGLE = "toggle",
	INPUT = "input",
	HIDDEN = "hidden",
}

export interface BaseField<I extends string> {
	id: I;
	type: FieldType;
	desc: string;
}

export type SettingsField =
	| HiddenField
	| InputField
	| ButtonField
	| ToggleField;

export interface ButtonField<I extends string = any> extends BaseField<I> {
	type: FieldType.BUTTON;
	text: string;
	onClick?: () => void;
}
export interface ToggleField<I extends string = any> extends BaseField<I> {
	type: FieldType.TOGGLE;
	onSelected?: (checked: boolean) => void;
}

export interface InputField<I extends string = any> extends BaseField<I> {
	type: FieldType.INPUT;
	inputType: string;
	onChange?: (value: string) => void;
}

export interface HiddenField<I extends string = any> extends BaseField<I> {
	type: FieldType.HIDDEN;
}

export class Settings<A = Record<string, never>> {
	public sectionFields: { [key: string]: JSX.Element } = {};
	private proxy;

	getName() {
		return this.name;
	}

	private constructor(
		private name: string,
		private id: string,
	) {
		this.proxy = new Proxy(
			{},
			{
				get: (target, prop) => Settings.getFieldValue(this.getId(prop.toString())),
				set: (target, prop, newValue) => {
					const id = this.getId(prop.toString());
					if (Settings.getFieldValue(id) !== newValue) {
						Settings.setFieldValue(id, newValue);
					}
					return true;
				},
			},
		);
	}

	static fromModule(mod: Module) {
		return new Settings(mod.getName(), mod.getModuleIdentifier());
	}

	get cfg() {
		return this.proxy as A;
	}

	finalize = () => {
		SettingsSectionRegistry.add(<this.SettingsSection />);
		return this;
	};

	addButton = <I extends string>(props: OmitType<ButtonField<I>>) => {
		this.addField(FieldType.BUTTON, props, this.ButtonField);
		return this;
	};

	addToggle = <I extends string>(
		props: OmitType<ToggleField<I>>,
		defaultValue: Task<boolean> = () => false,
	) => {
		this.addField(FieldType.TOGGLE, props, this.ToggleField, defaultValue);
		return this as Settings<A & { [X in I]: boolean }>;
	};

	addInput = <I extends string>(
		props: OmitType<InputField<I>>,
		defaultValue: Task<string> = () => "",
	) => {
		this.addField(FieldType.INPUT, props, this.InputField, defaultValue);
		return this as Settings<A & { [X in I]: string }>;
	};

	private addField<SF extends SettingsField>(
		type: SF["type"],
		opts: OmitType<SF>,
		fieldComponent: React.FC<SF>,
		defaultValue?: any,
	) {
		if (defaultValue !== undefined) {
			const settingId = this.getId(opts.id);
			Settings.setDefaultFieldValue(settingId, defaultValue);
		}
		const field = Object.assign({}, opts, { type }) as SF;
		this.sectionFields[opts.id] = React.createElement(fieldComponent, field);
	}

	getId = (nameId: string) => ["settings", this.id, nameId].join(":");

	private useStateFor = <A,>(id: string) => {
		const [value, setValueState] = React.useState(
			Settings.getFieldValue<A>(id),
		);

		return [
			value,
			(newValue: A) => {
				if (newValue !== undefined) {
					setValueState(newValue);
					Settings.setFieldValue(id, newValue);
				}
			},
		] as const;
	};

	static getFieldValue = <R,>(id: string): R => JSON.parse(localStorage[id] ?? "null");

	static setFieldValue = (id: string, newValue: any) => {
		localStorage[id] = JSON.stringify(newValue ?? null);
	};

	private static setDefaultFieldValue = async (
		id: string,
		defaultValue: Task<any>,
	) => {
		if (Settings.getFieldValue(id) === null) {
			Settings.setFieldValue(id, await defaultValue());
		}
	};

	private SettingsSection = () => {
		const [, refresh] = React.useReducer((n) => n + 1, 0);
		future.pull(refresh);

		if (!SettingsSection) {
			return;
		}

		return (
			<SettingsSection filterMatchQuery={this.name}>
				<SettingsSectionTitle>{this.name}</SettingsSectionTitle>
				{Object.values(this.sectionFields)}
			</SettingsSection>
		);
	};

	SettingField = (
		{ field, children }: { field: SettingsField; children?: any },
	) => (
		<S.SettingsRow filterMatchQuery={field.id}>
			<S.SettingsRowStart>
				<SettingsLabel htmlFor={field.id}>{field.desc}</SettingsLabel>
			</S.SettingsRowStart>
			<S.SettingsRowEnd>{children}</S.SettingsRowEnd>
		</S.SettingsRow>
	);

	ButtonField = (field: ButtonField) => (
		<this.SettingField field={field}>
			<UI.ButtonSecondary
				id={field.id}
				buttonSize="sm"
				onClick={field.onClick}
				className={MAP.settings.button.wrapper}
			>
				{field.text}
			</UI.ButtonSecondary>
		</this.SettingField>
	);

	ToggleField = (field: ToggleField) => {
		const id = this.getId(field.id);
		const [value, setValue] = this.useStateFor<boolean>(id);
		return (
			<this.SettingField field={field}>
				<SettingsToggle
					id={field.id}
					value={Settings.getFieldValue(id)}
					onSelected={(checked: boolean) => {
						setValue(checked);
						field.onSelected?.(checked);
					}}
				/>
			</this.SettingField>
		);
	};

	InputField = (field: InputField) => {
		const id = this.getId(field.id);
		const [value, setValue] = this.useStateFor<string>(id);
		return (
			<this.SettingField field={field}>
				<input
					className={MAP.settings.text_input}
					id={field.id}
					dir="ltr"
					value={Settings.getFieldValue(id)}
					type={field.inputType}
					onChange={(e) => {
						const value = e.currentTarget.value;
						setValue(value);
						field.onChange?.(value);
					}}
				/>
			</this.SettingField>
		);
	};
}

export const createSettings = (
	mod: Module & { settings?: Settings },
) => {
	if (!mod.settings) {
		mod.settings = Settings.fromModule(mod);
	}

	return [
		mod.settings,
		<SettingsButton section={mod.settings.getName()} />,
	] as const;
};
