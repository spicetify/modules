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

import { Registry } from "./registry.js";
import { S } from "../expose/index.js";
import { createIconComponent } from "../../lib/createIconComponent.js";
import { registerTransform } from "../../mixin.js";
import { isTouchscreenUi } from "../utils/index.js";
const registry = new class extends Registry {
    register(item, predicate) {
        super.register(item, predicate);
        refreshTopbarRightButtons?.();
        return item;
    }
    unregister(item) {
        super.unregister(item);
        refreshTopbarRightButtons?.();
        return item;
    }
}();
export default registry;
let refreshTopbarRightButtons;
let topbarRightButtonFactoryCtx;
globalThis.__renderTopbarRightButtons = ()=>S.React.createElement(()=>{
        const [refreshCount, refresh] = S.React.useReducer((x)=>x + 1, 0);
        refreshTopbarRightButtons = refresh;
        const topbarRightButtonFactory = isTouchscreenUi() ? TopbarRightButtonRound : TopbarRightButtonSquare;
        if (!topbarRightButtonFactoryCtx) topbarRightButtonFactoryCtx = S.React.createContext(null);
        return /*#__PURE__*/ S.React.createElement(topbarRightButtonFactoryCtx.Provider, {
            value: topbarRightButtonFactory
        }, registry.getItems(undefined, true).map((TopbarRightButton)=>/*#__PURE__*/ S.React.createElement(TopbarRightButton, null)));
    });
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/("login-button"[^\}]*\}[^\}]*\}[^\}]*\}\))/, "$1,__renderTopbarRightButtons()");
            emit();
            return str;
        },
    glob: /^\/xpui\.js/
});
export const Button = (props)=>{
    const TopbarRightButtonFactory = S.React.useContext(topbarRightButtonFactoryCtx);
    return TopbarRightButtonFactory && /*#__PURE__*/ S.React.createElement(TopbarRightButtonFactory, props);
};
const TopbarRightButtonRound = ({ label, disabled = false, onClick, icon })=>{
    /*#__PURE__*/ S.React.createElement(S.ReactComponents.Tooltip, {
        label: label
    }, /*#__PURE__*/ S.React.createElement(S.ReactComponents.UI.ButtonTertiary, {
        "aria-label": label,
        onClick: onClick,
        size: "small",
        condensedAll: true,
        className: "OomFKn3bsxs5JfNUoWhz"
    }, icon && createIconComponent({
        icon,
        iconSize: 16,
        realIconSize: 24
    })));
};
const TopbarRightButtonSquare = ({ label, disabled = false, onClick, icon })=>/*#__PURE__*/ S.React.createElement(S.ReactComponents.Tooltip, {
        label: label
    }, /*#__PURE__*/ S.React.createElement("button", {
        "aria-label": label,
        className: "encore-over-media-set WtC1lGbmQRplD6JBhNFU",
        onClick: onClick,
        disabled: disabled
    }, icon && createIconComponent({
        icon,
        iconSize: 16
    })));
