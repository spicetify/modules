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

export const waitForElement = <E extends Element>(selector: string, timeout = 5000, location = document.body, notEl?: E | null) =>
	new Promise((resolve: (value: E) => void, reject) => {
		const onMutation = () => {
			const el = document.querySelector<E>(selector);
			if (el) {
				if (notEl && el === notEl) {
				} else {
					observer.disconnect();
					return resolve(el);
				}
			}
		};

		const observer = new MutationObserver(onMutation);
		onMutation();

		observer.observe(location, {
			childList: true,
			subtree: true,
		});

		if (timeout)
			setTimeout(() => {
				observer.disconnect();
				console.debug();
				reject(`waitForElement: timed out waiting for ${selector}`);
			}, timeout);
	});

export const mainElement = document.querySelector("main")!;
export const [REACT_FIBER, REACT_PROPS] = Object.keys(mainElement);
