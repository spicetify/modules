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

import { registerTransform } from "../../mixin.js";
export const S = {};
S.GraphQLDefinitions = {
    query: {},
    mutation: {}
};
registerTransform({
    transform: (emit)=>(str)=>{
            const matches = str.matchAll(/(=new [a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\("(?<name>\w+)","(?<operation>query|mutation)","(?<sha256Hash>[\w\d]{64})",null\))/g);
            for (const match of matches){
                const { name, operation, sha256Hash } = match.groups;
                S.GraphQLDefinitions[operation][name] = {
                    name,
                    operation,
                    sha256Hash,
                    value: null
                };
            }
            emit();
            return str;
        },
    glob: /.+\.js$/
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/([a-zA-Z_\$][\w\$]*\.prototype\.setState=)/, "__React=t;$1");
            Object.defineProperty(globalThis, "__React", {
                set: emit
            });
            return str;
        },
    then: (React)=>{
        S.React = React;
    },
    glob: /^\/vendor~xpui\.js/
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/(([a-zA-Z_\$][\w\$]*)\.setDefaultProps=)/, "__Tippy=$2;$1");
            Object.defineProperty(globalThis, "__Tippy", {
                set: emit
            });
            return str;
        },
    then: (Tippy)=>{
        S.Tippy = Tippy;
    },
    glob: /^\/vendor~xpui\.js/
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/([a-zA-Z_\$][\w\$]*)=((?:function|\()([\w$.,{}()= ]+(?:springConfig|overshootClamping)){2})/, "$1=__ReactFlipToolkitSpring=$2");
            Object.defineProperty(globalThis, "__ReactFlipToolkitSpring", {
                set: emit
            });
            return str;
        },
    then: (ReactFlipToolkitSpring)=>{
        S.ReactFlipToolkitSpring = ReactFlipToolkitSpring;
    },
    glob: /^\/vendor~xpui\.js/
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/(setTitlebarHeight[\w(){}.,&$!=;"" ]+)(\{version:[a-zA-Z_\$][\w\$]*,)/, "$1__Platform=$2");
            Object.defineProperty(globalThis, "__Platform", {
                set: emit
            });
            return str;
        },
    then: async (Platform)=>{
        const { expose } = await import("./platform.js");
        Object.assign(S, expose({
            Platform
        }));
    },
    glob: /^\/xpui\.js/
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/(,[a-zA-Z_\$][\w\$]*=)(([$\w,.:=;(){}]+\(\{session:[a-zA-Z_\$][\w\$]*,features:[a-zA-Z_\$][\w\$]*,seoExperiment:[a-zA-Z_\$][\w\$]*\}))/, "$1__ReduxStore=$2");
            Object.defineProperty(globalThis, "__ReduxStore", {
                set: emit
            });
            return str;
        },
    then: (ReduxStore)=>{
        S.ReduxStore = ReduxStore;
    },
    glob: /^\/xpui\.js/
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/(\.call\(this,[a-zA-Z_\$][\w\$]*\)\|\|this\)\.enqueueSnackbar)/, "$1=__Snackbar");
            let __Snackbar = undefined;
            Object.defineProperty(globalThis, "__Snackbar", {
                set: (value)=>{
                    emit(value);
                    __Snackbar = value;
                },
                get: ()=>__Snackbar
            });
            return str;
        },
    then: async (Snackbar)=>{
        const { expose } = await import("./webpack.js");
        const { Platform, React } = S;
        Object.assign(S, expose({
            Snackbar,
            Platform,
            React
        }));
    },
    glob: /^\/vendor~xpui\.js/
});
// TODO: replace with a custom enqueueCustomSnackbar wrapper
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/(\(\({[^}]*,\s*imageSrc)/, "__enqueueImageSnackbar=$1");
            Object.defineProperty(globalThis, "__enqueueImageSnackbar", {
                set: emit
            });
            return str;
        },
    then: (enqueueImageSnackbar)=>{
        S.enqueueImageSnackbar = enqueueImageSnackbar;
    },
    glob: /^\/xpui\.js/,
    noAwait: true
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/(\.jsxs\)\()([a-zA-Z_\$][\w\$]*)([^=]*"desktop.settings.compatibility")/, "$1(__SettingsSection=$2)$3");
            Object.defineProperty(globalThis, "__SettingsSection", {
                set: emit
            });
            return str;
        },
    then: (SettingsSection)=>{
        S.SettingsSection = SettingsSection;
    },
    glob: /^\/xpui-routes-desktop-settings\.js/,
    noAwait: true
});
registerTransform({
    transform: (emit)=>(str)=>{
            str = str.replace(/("desktop.settings.compatibility"[^=]*?\.jsx\)\()([a-zA-Z_\$][\w\$]*)/, "$1(__SettingsSectionTitle=$2)");
            Object.defineProperty(globalThis, "__SettingsSectionTitle", {
                set: emit
            });
            return str;
        },
    then: (SettingsSectionTitle)=>{
        S.SettingsSectionTitle = SettingsSectionTitle;
    },
    glob: /^\/xpui-routes-desktop-settings\.js/,
    noAwait: true
});
