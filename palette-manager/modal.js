/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */ import { useSearchBar } from "/modules/official/stdlib/lib/components/index.js";
import { Palette, PaletteManager } from "./palette.js";
import { createIconComponent } from "/modules/official/stdlib/lib/createIconComponent.js";
import { startCase } from "/modules/official/stdlib/deps.js";
import { React } from "/modules/official/stdlib/src/expose/React.js";
import { MenuItem } from "/modules/official/stdlib/src/webpack/ReactComponents.js";
import { Platform } from "/modules/official/stdlib/src/expose/Platform.js";
import { Color } from "/modules/official/stdlib/src/webpack/misc.js";
export default function() {
    const setCurrentPalette = (_, palette)=>PaletteManager.INSTANCE.setCurrent(palette);
    const getCurrentPalette = (_)=>PaletteManager.INSTANCE.getCurrent();
    const [selectedPalette, selectPalette] = React.useReducer(setCurrentPalette, undefined, getCurrentPalette);
    const getPalettes = ()=>PaletteManager.INSTANCE.getPalettes();
    const [palettes, updatePalettes] = React.useReducer(getPalettes, undefined, getPalettes);
    const [searchbar, search] = useSearchBar({
        placeholder: "Search Palettes",
        expanded: true
    });
    function createPalette() {
        PaletteManager.INSTANCE.addUserPalette(new Palette(crypto.randomUUID(), "New Palette", selectedPalette.colors, false));
        updatePalettes();
    }
    const filteredPalettes = palettes.filter((palette)=>palette.name.toLowerCase().includes(search.toLowerCase()));
    return /*#__PURE__*/ React.createElement("div", {
        className: "palette-modal-container"
    }, /*#__PURE__*/ React.createElement("div", {
        className: "palette-list-container"
    }, /*#__PURE__*/ React.createElement("ul", null, searchbar, /*#__PURE__*/ React.createElement(MenuItem, {
        leadingIcon: createIconComponent({
            icon: '<path d="M14 7H9V2H7v5H2v2h5v5h2V9h5z"/><path fill="none" d="M0 0h16v16H0z"/>'
        }),
        divider: "after",
        onClick: createPalette
    }, "Create New Palette"), /*#__PURE__*/ React.createElement("ul", {
        className: "palette-list"
    }, filteredPalettes.map((palette)=>/*#__PURE__*/ React.createElement(MenuItem, {
            key: palette.id,
            trailingIcon: palette === selectedPalette && createIconComponent({
                icon: '<path d="M15.53 2.47a.75.75 0 0 1 0 1.06L4.907 14.153.47 9.716a.75.75 0 0 1 1.06-1.06l3.377 3.376L14.47 2.47a.75.75 0 0 1 1.06 0z"/>'
            }),
            onClick: ()=>selectPalette(palette)
        }, palette.name))))), /*#__PURE__*/ React.createElement(PaletteFields, {
        palette: selectedPalette,
        updatePalettes: updatePalettes
    }));
}
const PaletteFields = (props)=>{
    return /*#__PURE__*/ React.createElement("div", {
        className: "palette-fields-container"
    }, /*#__PURE__*/ React.createElement(LocalInfo, {
        palette: props.palette,
        updatePalettes: props.updatePalettes
    }), /*#__PURE__*/ React.createElement("div", {
        className: "palette-fields"
    }, Object.entries(props.palette.colors).map(([name, value])=>/*#__PURE__*/ React.createElement(PaletteField, {
            key: name,
            name: name,
            value: value,
            palette: props.palette
        }))));
};
const PaletteField = (props)=>{
    const updater = props.palette.colors[props.name].toCSS(Color.Format.HEX);
    const [value, setValue] = React.useState(updater);
    const updateValue = useUpdater(setValue)(updater);
    const onChange = React.useCallback((e)=>{
        const value = e.target.value;
        setValue(value);
        let color;
        try {
            color = Color.fromHex(value);
        } catch (_) {}
        if (!color) {
            return;
        }
        const colors = {
            ...props.palette.colors,
            [props.name]: color
        };
        if (props.palette.overwrite(colors)) {
            PaletteManager.INSTANCE.save();
        }
        if (PaletteManager.INSTANCE.isCurrent(props.palette)) {
            PaletteManager.INSTANCE.writeCurrent();
        }
    }, [
        props.palette
    ]);
    return /*#__PURE__*/ React.createElement("div", {
        className: "input-row"
    }, /*#__PURE__*/ React.createElement("label", null, startCase(props.name)), /*#__PURE__*/ React.createElement("input", {
        className: "color-input",
        type: "color",
        value: value,
        onChange: onChange
    }), /*#__PURE__*/ React.createElement("input", {
        className: "text-input",
        type: "text",
        value: value,
        onChange: onChange
    }));
};
const LocalInfo = (props)=>{
    const [name, setName] = React.useState(props.palette.name);
    const updateName = useUpdater(setName)(props.palette.name);
    function deletePalette(palette) {
        PaletteManager.INSTANCE.deleteUserPalette(palette);
        props.updatePalettes();
    }
    function renamePalette(palette, name) {
        PaletteManager.INSTANCE.renameUserPalette(palette, name);
        props.updatePalettes();
    }
    return /*#__PURE__*/ React.createElement("div", {
        className: "palette-info"
    }, /*#__PURE__*/ React.createElement("input", {
        className: "palette-name",
        readOnly: props.palette.isStatic,
        placeholder: "Custom Palette",
        value: props.palette.isStatic ? name + " (static)" : name,
        onChange: (e)=>setName(e.target.value)
    }), !props.palette.isStatic && [
        /*#__PURE__*/ React.createElement("button", {
            type: "button",
            key: "delete",
            onClick: ()=>deletePalette(props.palette)
        }, "Delete"),
        /*#__PURE__*/ React.createElement("button", {
            type: "button",
            key: "rename",
            onClick: ()=>renamePalette(props.palette, name)
        }, "Rename")
    ], /*#__PURE__*/ React.createElement("button", {
        type: "button",
        onClick: ()=>{
            const css = JSON.stringify(props.palette);
            Platform.getClipboardAPI().copy(css);
        }
    }, "Copy Object"));
};
export const useUpdater = (dispatch)=>(updater)=>{
        const updateState = React.useCallback(()=>dispatch(updater), [
            updater
        ]);
        React.useEffect(updateState, [
            updateState
        ]);
        return updateState;
    };
