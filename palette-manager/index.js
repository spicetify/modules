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
 */

import { S } from "/modules/official/stdlib/index.js";
import { SVGIcons, createRegistrar } from "/modules/official/stdlib/index.js";
import { display } from "/modules/official/stdlib/lib/modal.js";
import { Button } from "/modules/official/stdlib/src/registers/topbarLeftButton.js";
import Modal from "./modal.js";
import paletteManager from "./paletteManager.js";
const EditButton = () => {
	return /*#__PURE__*/ S.React.createElement(Button, {
		label: "Palette Manager",
		icon: SVGIcons.edit,
		onClick: () => {
			display({
				title: "Palette Manager",
				content: /*#__PURE__*/ S.React.createElement(Modal, null),
				isLarge: true,
			});
		},
	});
};
export default function (mod) {
	const registrar = createRegistrar(mod);
	registrar.register("topbarLeftButton", EditButton);
	createSchemes();
}
function createSchemes() {
	paletteManager.createStatics(
		[
			{
				name: "Spicetify",
				fields: {
					text: "#ffffff",
					subtext: "#c0b4b4",
					base: "#0a0a0f",
					main: "#0F111A",
					main_elevated: "#1b1e2c",
					highlight: "#1b1e2c",
					highlight_elevated: "#1b1e2c",
					card: "#0a0a0f",
					button: "#FF4151",
					button_active: "#ff5c69",
					notification: "#33bacc",
					tab: "#c0b4b4",
					tab_active: "#FF4151",
					playbar: "#c0b4b4",
					playbar_active: "#FF4151",
				},
			},
			{
				name: "Nord",
				fields: {
					text: "#eceff4",
					subtext: "#d8dee9",
					base: "#23272f",
					main: "#2e3440",
					main_elevated: "#3b4252",
					highlight: "#3b4252",
					highlight_elevated: "#434c5e",
					card: "#2e3440",
					button: "#8fbcbb",
					button_active: "#9fcbca",
					notification: "#88c0d0",
					tab: "#d8dee9",
					tab_active: "#81a1c1",
					playbar: "#81a1c1",
					playbar_active: "#8fbcbb",
				},
			},
		],
		"inbuilt",
	);
}
