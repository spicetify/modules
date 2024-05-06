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

export type Predicate<I> = (input: I) => boolean;

export class Registry<A, B> {
	_A = undefined as A;
	_B = undefined as B;

	private registered = new Map<A, Predicate<B>>();

	getItems(input: B, reverse = false) {
		const items = Array.from(this.registered.entries())
			.map(([i, p]) => p(input) && i)
			.filter(Boolean) as A[];
		reverse && items.reverse();
		return items;
	}

	register(item: A, predicate: Predicate<B>) {
		this.registered.set(item, predicate);
		return item;
	}

	unregister(item: A) {
		this.registered.delete(item);
		return item;
	}
}
