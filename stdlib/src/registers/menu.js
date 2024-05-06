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
import { matchLast } from "/hooks/util.js";
import { registerTransform } from "../../mixin.js";
const registry = new Registry();
export default registry;
export const useMenuItem = ()=>S.React.useContext(globalThis.__MenuContext);
globalThis.__renderMenuItems = ()=>{
    const context = useMenuItem();
    return registry.getItems(context);
};
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/("Menu".+?children:)([a-zA-Z_\$][\w\$]*)/, "$1[__renderMenuItems(),$2].flat()");
            const croppedInput = str.match(/.*value:"contextmenu"/)[0];
            const react = matchLast(croppedInput, /([a-zA-Z_\$][\w\$]*)\.useRef/g)[1];
            const menu = matchLast(croppedInput, /menu:([a-zA-Z_\$][\w\$]*)/g)[1];
            const trigger = matchLast(croppedInput, /trigger:([a-zA-Z_\$][\w\$]*)/g)[1];
            const target = matchLast(croppedInput, /triggerRef:([a-zA-Z_\$][\w\$]*)/g)[1];
            str = str.replace(/(\(0,([a-zA-Z_\$][\w\$]*)\.jsx\)\([a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*,\{value:"contextmenu"[^\}]*\}\)\}\))/, `$2.jsx((globalThis.__MenuContext||(globalThis.__MenuContext=${react}.createContext(null))).Provider,{value:{props:${menu}?.props,trigger:${trigger},target:${target}},children:$1})`);
            emit();
            return str;
        },
    glob: /^\/xpui\.js/
});
export const createProfileMenuShouldAdd = ()=>({ trigger, target })=>trigger === "click" && target.getAttribute("data-testid") === "user-widget-link";
