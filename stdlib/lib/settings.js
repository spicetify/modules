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
const { React } = S;
export var FieldType;
(function(FieldType) {
    FieldType["BUTTON"] = "button";
    FieldType["TOGGLE"] = "toggle";
    FieldType["INPUT"] = "input";
    FieldType["HIDDEN"] = "hidden";
})(FieldType || (FieldType = {}));
import SettingsSectionRegistry from "../src/registers/settingsSection.js";
import SettingsButton from "./components/SettingsButton.js";
export class Settings {
    name;
    id;
    sectionFields;
    proxy;
    getName() {
        return this.name;
    }
    constructor(name, id){
        this.name = name;
        this.id = id;
        this.sectionFields = {};
        this.finalize = ()=>{
            SettingsSectionRegistry.register(/*#__PURE__*/ S.React.createElement(this.SettingsSection, null), ()=>true);
            return this;
        };
        this.addButton = (props)=>{
            this.addField("button", props, this.ButtonField);
            return this;
        };
        this.addToggle = (props, defaultValue = ()=>false)=>{
            this.addField("toggle", props, this.ToggleField, defaultValue);
            return this;
        };
        this.addInput = (props, defaultValue = ()=>"")=>{
            this.addField("input", props, this.InputField, defaultValue);
            return this;
        };
        this.getId = (nameId)=>[
                "settings",
                this.id,
                nameId
            ].join(":");
        this.useStateFor = (id)=>{
            const [value, setValueState] = React.useState(Settings.getFieldValue(id));
            return [
                value,
                (newValue)=>{
                    if (newValue !== undefined) {
                        setValueState(newValue);
                        Settings.setFieldValue(id, newValue);
                    }
                }
            ];
        };
        this.SettingsSection = ()=>/*#__PURE__*/ S.React.createElement(S.SettingsSection, {
                filterMatchQuery: this.name
            }, /*#__PURE__*/ S.React.createElement(S.SettingsSectionTitle, null, this.name), Object.values(this.sectionFields));
        this.SettingField = ({ field, children })=>/*#__PURE__*/ S.React.createElement(S.ReactComponents.SettingColumn, {
                filterMatchQuery: field.id
            }, /*#__PURE__*/ S.React.createElement("div", {
                className: "GMGmbx5FRBd6DOVvzSgk"
            }, /*#__PURE__*/ S.React.createElement(S.ReactComponents.SettingText, {
                htmlFor: field.id
            }, field.desc)), /*#__PURE__*/ S.React.createElement("div", {
                className: "yNitN64xoLNhzJlkfzOh"
            }, children));
        this.ButtonField = (field)=>/*#__PURE__*/ S.React.createElement(this.SettingField, {
                field: field
            }, /*#__PURE__*/ S.React.createElement(S.ReactComponents.UI.ButtonSecondary, {
                id: field.id,
                buttonSize: "sm",
                onClick: field.onClick,
                className: "rFFJg1UIumqUUFDgo6n7"
            }, field.text));
        this.ToggleField = (field)=>{
            const id = this.getId(field.id);
            const [value, setValue] = this.useStateFor(id);
            return /*#__PURE__*/ S.React.createElement(this.SettingField, {
                field: field
            }, /*#__PURE__*/ S.React.createElement(S.ReactComponents.SettingToggle, {
                id: field.id,
                value: Settings.getFieldValue(id),
                onSelected: (checked)=>{
                    setValue(checked);
                    field.onSelected?.(checked);
                },
                className: "rFFJg1UIumqUUFDgo6n7"
            }));
        };
        this.InputField = (field)=>{
            const id = this.getId(field.id);
            const [value, setValue] = this.useStateFor(id);
            return /*#__PURE__*/ S.React.createElement(this.SettingField, {
                field: field
            }, /*#__PURE__*/ S.React.createElement("input", {
                className: "SkbGMKYv49KtJNB5XxdX",
                id: field.id,
                dir: "ltr",
                value: Settings.getFieldValue(id),
                type: field.inputType,
                onChange: (e)=>{
                    const value = e.currentTarget.value;
                    setValue(value);
                    field.onChange?.(value);
                }
            }));
        };
        this.proxy = new Proxy({}, {
            get: (target, prop)=>Settings.getFieldValue(this.getId(prop.toString())),
            set: (target, prop, newValue)=>{
                const id = this.getId(prop.toString());
                if (Settings.getFieldValue(id) !== newValue) {
                    Settings.setFieldValue(id, newValue);
                }
                return true;
            }
        });
    }
    static fromModule(mod) {
        return new Settings(mod.getName(), mod.getIdentifier());
    }
    get cfg() {
        return this.proxy;
    }
    finalize;
    addButton;
    addToggle;
    addInput;
    addField(type, opts, fieldComponent, defaultValue) {
        if (defaultValue !== undefined) {
            const settingId = this.getId(opts.id);
            Settings.setDefaultFieldValue(settingId, defaultValue);
        }
        const field = Object.assign({}, opts, {
            type
        });
        this.sectionFields[opts.id] = React.createElement(fieldComponent, field);
    }
    getId;
    useStateFor;
    static getFieldValue = (id)=>JSON.parse(localStorage[id] ?? "null");
    static setFieldValue = (id, newValue)=>{
        localStorage[id] = JSON.stringify(newValue ?? null);
    };
    static setDefaultFieldValue = async (id, defaultValue)=>{
        if (Settings.getFieldValue(id) === null) Settings.setFieldValue(id, await defaultValue());
    };
    SettingsSection;
    SettingField;
    ButtonField;
    ToggleField;
    InputField;
}
export const createSettings = (mod)=>{
    if (!mod.settings) {
        mod.settings = Settings.fromModule(mod);
    }
    return [
        mod.settings,
        /*#__PURE__*/ S.React.createElement(SettingsButton, {
            section: mod.settings.getName()
        })
    ];
};
