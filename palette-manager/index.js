/* Copyright © 2024
 *      harbassan <harbassan@hotmail.com>
 *
 * This file is part of bespoke/modules/palette-manager.
 *
 * bespoke/modules/palette-manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * bespoke/modules/palette-manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with bespoke/modules/palette-manager. If not, see <https://www.gnu.org/licenses/>.
 */ import { createRegistrar, createStorage } from "/modules/official/stdlib/index.js";
import { React } from "/modules/official/stdlib/src/expose/React.js";
import { Color } from "/modules/official/stdlib/src/webpack/misc.js";
export let storage;
export default async function(mod) {
    const registrar = createRegistrar(mod);
    storage = createStorage(mod);
    const schemer = (await import("./schemer.js")).createSchemer(mod);
    const { EditButton } = await import("./paletteManager.js");
    registrar.register("topbarLeftButton", /*#__PURE__*/ React.createElement(EditButton, null));
    schemer.register("Spicetify", {
        text: Color.fromHex("#ffffff"),
        subtext: Color.fromHex("#c0b4b4"),
        base: Color.fromHex("#0a0a0f"),
        main: Color.fromHex("#0F111A"),
        main_elevated: Color.fromHex("#1b1e2c"),
        highlight: Color.fromHex("#1b1e2c"),
        highlight_elevated: Color.fromHex("#1b1e2c"),
        card: Color.fromHex("#0a0a0f"),
        button: Color.fromHex("#FF4151"),
        button_active: Color.fromHex("#ff5c69"),
        notification: Color.fromHex("#33bacc"),
        tab: Color.fromHex("#c0b4b4"),
        tab_active: Color.fromHex("#FF4151"),
        playbar: Color.fromHex("#c0b4b4"),
        playbar_active: Color.fromHex("#FF4151")
    });
    schemer.register("Nord", {
        text: Color.fromHex("#eceff4"),
        subtext: Color.fromHex("#d8dee9"),
        base: Color.fromHex("#23272f"),
        main: Color.fromHex("#2e3440"),
        main_elevated: Color.fromHex("#3b4252"),
        highlight: Color.fromHex("#3b4252"),
        highlight_elevated: Color.fromHex("#434c5e"),
        card: Color.fromHex("#2e3440"),
        button: Color.fromHex("#8fbcbb"),
        button_active: Color.fromHex("#9fcbca"),
        notification: Color.fromHex("#88c0d0"),
        tab: Color.fromHex("#d8dee9"),
        tab_active: Color.fromHex("#81a1c1"),
        playbar: Color.fromHex("#81a1c1"),
        playbar_active: Color.fromHex("#8fbcbb")
    });
}
