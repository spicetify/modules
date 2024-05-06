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

import menu from "./menu.js";
import root from "./root.js";
import route from "./route.js";
import navlink from "./navlink.js";
import playbarControl from "./playbarControl.js";
import playbarWidget from "./playbarWidget.js";
import settingsSection from "./settingsSection.js";
import topbarLeftButton from "./topbarLeftButton.js";
import topbarRightButton from "./topbarRightButton.js";

// It's ugly, but we gotta do it statically to get type completions
const registers = { menu, root, route, navlink, playbarControl, playbarWidget, settingsSection, topbarLeftButton, topbarRightButton };
type Registers = typeof registers;

import type { Predicate } from "./registry.js";

export class Registrar {
	constructor(public id: string) {}

	ledger = new Map<Registers[keyof Registers]["_A"], keyof Registers>();

	register<R extends keyof Registers>(type: R, item: Registers[R]["_A"], predicate: Predicate<Registers[R]["_B"]> = () => true) {
		this.ledger.set(item, type);
		registers[type].register(item, predicate);
	}

	unregister<R extends keyof Registers>(type: R, item: Registers[R]["_A"]) {
		this.ledger.delete(item);
		registers[type].unregister(item);
	}

	dispose() {
		for (const [item, type] of this.ledger.entries()) this.unregister(type, item);
		this.ledger.clear();
	}
}
