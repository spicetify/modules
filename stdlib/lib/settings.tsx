/* Copyright © 2024
 *      Delusoire <deluso7re@outlook.com>
 *
 * This file is part of bespoke/modules/stdlib.
 *
 * bespoke/modules/stdlib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * bespoke/modules/stdlib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with bespoke/modules/stdlib. If not, see <https://www.gnu.org/licenses/>.
 */

import { S } from "../src/expose/index.js";

type Task<A> = (() => Awaited<A>) | (() => Promise<Awaited<A>>);

const { React } = S;

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

export type SettingsField = HiddenField | InputField | ButtonField | ToggleField;

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

import SettingsSectionRegistry from "../src/registers/settingsSection.js";
import SettingsButton from "./components/SettingsButton.js";
import type { Module } from "/hooks/module.js";

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
		return new Settings(mod.getName(), mod.getIdentifier());
	}

	get cfg() {
		return this.proxy as A;
	}

	finalize = () => {
		SettingsSectionRegistry.register(<this.SettingsSection />, () => true);
		return this;
	};

	addButton = <I extends string>(props: OmitType<ButtonField<I>>) => {
		this.addField(FieldType.BUTTON, props, this.ButtonField);
		return this;
	};

	addToggle = <I extends string>(props: OmitType<ToggleField<I>>, defaultValue: Task<boolean> = () => false) => {
		this.addField(FieldType.TOGGLE, props, this.ToggleField, defaultValue);
		return this as Settings<A & { [X in I]: boolean }>;
	};

	addInput = <I extends string>(props: OmitType<InputField<I>>, defaultValue: Task<string> = () => "") => {
		this.addField(FieldType.INPUT, props, this.InputField, defaultValue);
		return this as Settings<A & { [X in I]: string }>;
	};

	private addField<SF extends SettingsField>(type: SF["type"], opts: OmitType<SF>, fieldComponent: React.FC<SF>, defaultValue?: any) {
		if (defaultValue !== undefined) {
			const settingId = this.getId(opts.id);
			Settings.setDefaultFieldValue(settingId, defaultValue);
		}
		const field = Object.assign({}, opts, { type }) as SF;
		this.sectionFields[opts.id] = React.createElement(fieldComponent, field);
	}

	getId = (nameId: string) => ["settings", this.id, nameId].join(":");

	private useStateFor = <A,>(id: string) => {
		const [value, setValueState] = React.useState(Settings.getFieldValue<A>(id));

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

	private static setDefaultFieldValue = async (id: string, defaultValue: Task<any>) => {
		if (Settings.getFieldValue(id) === null) Settings.setFieldValue(id, await defaultValue());
	};

	private SettingsSection = () => (
		<S.SettingsSection filterMatchQuery={this.name}>
			<S.SettingsSectionTitle>{this.name}</S.SettingsSectionTitle>
			{Object.values(this.sectionFields)}
		</S.SettingsSection>
	);

	SettingField = ({ field, children }: { field: SettingsField; children?: any }) => (
		<S.ReactComponents.SettingColumn filterMatchQuery={field.id}>
			<div className="x-settings-firstColumn">
				<S.ReactComponents.SettingText htmlFor={field.id}>{field.desc}</S.ReactComponents.SettingText>
			</div>
			<div className="x-settings-secondColumn">{children}</div>
		</S.ReactComponents.SettingColumn>
	);

	ButtonField = (field: ButtonField) => (
		<this.SettingField field={field}>
			<S.ReactComponents.UI.ButtonSecondary id={field.id} buttonSize="sm" onClick={field.onClick} className="x-settings-button">
				{field.text}
			</S.ReactComponents.UI.ButtonSecondary>
		</this.SettingField>
	);

	ToggleField = (field: ToggleField) => {
		const id = this.getId(field.id);
		const [value, setValue] = this.useStateFor<boolean>(id);
		return (
			<this.SettingField field={field}>
				<S.ReactComponents.SettingToggle
					id={field.id}
					value={Settings.getFieldValue(id)}
					onSelected={(checked: boolean) => {
						setValue(checked);
						field.onSelected?.(checked);
					}}
					className="x-settings-button"
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
					className="x-settings-input"
					id={field.id}
					dir="ltr"
					value={Settings.getFieldValue(id)}
					type={field.inputType}
					onChange={e => {
						const value = e.currentTarget.value;
						setValue(value);
						field.onChange?.(value);
					}}
				/>
			</this.SettingField>
		);
	};
}

export const createSettings = (mod: Module & { settings?: Settings }) => {
	if (!mod.settings) {
		mod.settings = Settings.fromModule(mod);
	}

	return [mod.settings, <SettingsButton section={mod.settings.getName()} />] as const;
};
