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
const registry = new Registry();
export default registry;
globalThis.__renderNowPlayingWidgets = registry.getItems.bind(registry);
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/(hideButtonFactory[^\]]*)/, "$1,...__renderNowPlayingWidgets()");
            emit();
            return str;
        },
    glob: /^\/xpui\.js/
});
export const NowPlayingWidget = ({ label, icon, onClick })=>/*#__PURE__*/ S.React.createElement(S.ReactComponents.Tooltip, {
        label: label
    }, /*#__PURE__*/ S.React.createElement(S.ReactComponents.UI.ButtonTertiary, {
        size: "small",
        className: undefined,
        "aria-label": label,
        condensed: false,
        iconOnly: icon && (()=>createIconComponent({
                icon
            })),
        onClick: onClick
    }));
