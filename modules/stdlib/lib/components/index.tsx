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

import { React } from "../../src/expose/React.ts";
import { _ } from "../../deps.ts";
import Dropdown, { type DropdownOptions } from "./Dropdown.tsx";
import { ChipFilter } from "./ChipFilter.tsx";
import { FilterContext } from "../../src/webpack/FilterContext.ts";
import { FilterBox } from "../../src/webpack/ReactComponents.ts";

// * Who doesn't love some Fixed Point (Functional) Programming?
const Bluebird =
	<A, B>(a: (b: B) => A) =>
		<C,>(b: (c: C) => B) =>
			(c: C) =>
				a(b(c));

const createStorage = (provider: Pick<Storage, "getItem" | "setItem">) => ({
	getItem(key: string, def: () => any) {
		const v = provider.getItem(key);
		return JSON.parse(v!) ?? def();
	},
	setItem(key: string, value: any) {
		const v = JSON.stringify(value);
		provider.setItem(key, v);
	},
});

type Thunk<A> = () => A;

const usePersistedState =
	({ getItem, setItem }: ReturnType<typeof createStorage>) =>
		<K extends string>(key: K) =>
			<A,>(initialState: Thunk<A>) => {
				const [state, setState] = React.useState<A>(() => getItem(key, initialState));

				const persistentSetState = React.useCallback(
					(reducer: (state: A) => A) => {
						const nextState = reducer(state);

						setItem(key, nextState);
						setState(nextState);
					},
					[state, setItem, key],
				);

				return [state, persistentSetState] as const;
			};

const createPersistedState = Bluebird(usePersistedState)(createStorage);

interface UseDropdownOpts<O extends DropdownOptions> {
	options: O;
	storage?: Storage;
	storageVariable?: string;
}

export const useDropdown = <O extends DropdownOptions>({
	options,
	storage,
	storageVariable,
}: UseDropdownOpts<O>) => {
	// We do this because we don't want the variable to change
	const [initialStorageVariable] = React.useState(storageVariable);
	const getDefaultOption = () => Object.keys(options)[0] as typeof activeOption;
	let activeOption: Extract<keyof typeof options, string>;
	let setActiveOption: (reducer: (state: typeof activeOption) => typeof activeOption) => void;
	if (storage && initialStorageVariable) {
		[activeOption, setActiveOption] = createPersistedState(storage)(`drop-down:${initialStorageVariable}`)<
			typeof activeOption
		>(getDefaultOption);
	} else {
		[activeOption, setActiveOption] = React.useState(getDefaultOption);
	}

	const dropdown = (
		<Dropdown
			options={options}
			activeOption={activeOption}
			onSwitch={o => setActiveOption(() => o)}
		/>
	);

	return [dropdown, activeOption, setActiveOption] as const;
};

export const getProp = (obj: any, path: string) => {
	if (path.startsWith(".")) {
		return _.get(obj, path.slice(1));
	}
	return obj;
};

export const useSearchBar = ({ placeholder, expanded }: { placeholder: string; expanded: boolean; }) => {
	const [search, setSearch] = React.useState("");
	const searchProps = { filter: "", setFilter: (f: string) => setSearch(f) };

	const searchbar = (
		<FilterContext.Provider value={searchProps}>
			<FilterBox
				alwaysExpanded={expanded}
				placeholder={placeholder}
			/>
		</FilterContext.Provider>
	);

	return [searchbar, search] as const;
};

export const TreeNodeVal = Symbol.for("TreeNodeVal");
export type Tree<E> = {
	[TreeNodeVal]?: E;
	[key: string]: Tree<E>;
};

export type RTree<E> = {
	[TreeNodeVal]: E;
	[key: string]: Tree<E>;
};

export type FilterOpt = { key: string, filter: Tree<React.ReactNode>; };
export type RFilterOpt = { key: string; filter: Required<Tree<React.ReactNode>>; };

export const useChipFilter = (filters: Tree<React.ReactNode>) => {
	const [selectedFilterFullKey, setSelectedFilterFullKey] = React.useState("");

	const selectedFilters = React.useMemo(
		() =>
			selectedFilterFullKey
				.split(".")
				.slice(1,)
				.reduce(
					(selectedFilters, selectedFilterFullKeyPart) => {
						const prevSelectedFilter = selectedFilters.at(-1)!;
						const selectedFilter = {
							key: `${prevSelectedFilter.key}.${selectedFilterFullKeyPart}`,
							filter: prevSelectedFilter.filter[selectedFilterFullKeyPart],
						};
						selectedFilters.push(selectedFilter);
						return selectedFilters;
					},
					[{ key: "", filter: filters }],
				),
		[filters, selectedFilterFullKey],
	);

	const lastSelectedFilter = selectedFilters.at(-1)!;
	const availableFilters = new Array<FilterOpt>();
	for (const [k, v] of Object.entries(lastSelectedFilter.filter)) {
		availableFilters.push({ key: `${lastSelectedFilter.key}.${k}`, filter: v });
	}

	const toggleFilter = React.useCallback(
		(filter: RFilterOpt) =>
			setSelectedFilterFullKey(filter.key === selectedFilterFullKey ? "" : filter.key),
		[selectedFilterFullKey],
	);
	const treeNodeHasVal = (n: FilterOpt): n is RFilterOpt => !!n.filter[TreeNodeVal];

	const chipFilter = (
		<ChipFilter
			selectedFilters={selectedFilters.filter(treeNodeHasVal)}
			availableFilters={availableFilters.filter(treeNodeHasVal)}
			toggleFilter={toggleFilter}
		/>
	);

	return [chipFilter, selectedFilters, selectedFilterFullKey, setSelectedFilterFullKey] as const;
};
