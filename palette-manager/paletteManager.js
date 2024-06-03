/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */ import { TopbarLeftButton } from "/modules/official/stdlib/src/registers/topbarLeftButton.js";
import Modal from "/modules/official/palette-manager/modal.js";
import { React } from "/modules/official/stdlib/src/expose/React.js";
import { display } from "/modules/official/stdlib/lib/modal.js";
export const EditButton = ()=>{
    return /*#__PURE__*/ React.createElement(TopbarLeftButton, {
        label: "Palette Manager",
        icon: '<path d="M11.472.279L2.583 10.686l-.887 4.786 4.588-1.625L15.173 3.44 11.472.279zM5.698 12.995l-2.703.957.523-2.819v-.001l2.18 1.863zm-1.53-2.623l7.416-8.683 2.18 1.862-7.415 8.683-2.181-1.862z"/>',
        onClick: ()=>{
            display({
                title: "Palette Manager",
                content: /*#__PURE__*/ React.createElement(Modal, null),
                isLarge: true
            });
        }
    });
};
