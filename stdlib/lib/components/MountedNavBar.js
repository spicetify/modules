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

import { S } from "../../index.js";
import { isTouchscreenUi } from "../../src/utils/index.js";
const { ReactDOM } = S;
const NavToChip = ({ to, title, selected, onClick })=>/*#__PURE__*/ S.React.createElement(S.ReactComponents.NavTo, {
        replace: true,
        to: to,
        tabIndex: -1,
        onClick: onClick,
        className: "ZWI7JsjzJaR_G8Hy4W6J"
    }, /*#__PURE__*/ S.React.createElement(S.ReactComponents.UI.Chip, {
        selected: selected,
        selectedColorSet: "invertedLight",
        tabIndex: -1
    }, title));
const NavBar = ({ namespace, categories, selectedCategory })=>/*#__PURE__*/ S.React.createElement("div", {
        className: "fVB_YDdnaDlztX7CcWTA"
    }, /*#__PURE__*/ S.React.createElement("div", {
        className: "e179_Eg8r7Ub6yjjxctr contentSpacing"
    }, /*#__PURE__*/ S.React.createElement("div", {
        className: "VIeVCUUETJyYPCDpsBif"
    }, /*#__PURE__*/ S.React.createElement(S.ReactComponents.ScrollableContainer, null, categories.map((category)=>/*#__PURE__*/ S.React.createElement(NavToChip, {
            to: `spotify:app:bespoke:${namespace}:${category}`,
            title: category,
            selected: category === selectedCategory
        }, category))))));
const TopBarMounted = ({ children })=>{
    const touchscreenUi = isTouchscreenUi();
    const component = /*#__PURE__*/ S.React.createElement("div", {
        className: "main-topbar-topbarContent",
        style: {
            pointerEvents: "all"
        }
    }, children);
    return touchscreenUi ? component : ReactDOM.createPortal(component, document.querySelector(".rovbQsmAS_mwvpKHaVhQ"));
};
export const TopNavBar = (props)=>/*#__PURE__*/ S.React.createElement(TopBarMounted, null, /*#__PURE__*/ S.React.createElement(NavBar, props));
