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

import { S } from "/modules/official/stdlib/index.js";
const { React } = S;
import { _ } from "/modules/official/stdlib/deps.js";
import Dropdown from "./Dropdown.js";
import { ChipFilter } from "./ChipFilter.js";
// * Who doesn't love some Fixed Point (Functional) Programming?
const Bluebird = a => b => c => a(b(c));
const createStorage = provider => ({
	getItem(key, def) {
		const v = provider.getItem(key);
		return JSON.parse(v) ?? def();
	},
	setItem(key, value) {
		const v = JSON.stringify(value);
		provider.setItem(key, v);
	},
});
const usePersistedState =
	({ getItem, setItem }) =>
	key =>
	initialState => {
		const [state, setState] = React.useState(() => getItem(key, initialState));
		const persistentSetState = React.useCallback(
			reducer => {
				const nextState = reducer(state);
				setItem(key, nextState);
				setState(nextState);
			},
			[state, setItem, key],
		);
		return [state, persistentSetState];
	};
const createPersistedState = Bluebird(usePersistedState)(createStorage);
export const useDropdown = ({ options, storage, storageVariable }) => {
	// We do this because we don't want the variable to change
	const [initialStorageVariable] = React.useState(storageVariable);
	const getDefaultOption = () => Object.keys(options)[0];
	let activeOption;
	let setActiveOption;
	if (storage && initialStorageVariable) {
		[activeOption, setActiveOption] = createPersistedState(storage)(`drop-down:${initialStorageVariable}`)(getDefaultOption);
	} else {
		[activeOption, setActiveOption] = React.useState(getDefaultOption);
	}
	const dropdown = /*#__PURE__*/ S.React.createElement(Dropdown, {
		options: options,
		activeOption: activeOption,
		onSwitch: o => setActiveOption(() => o),
	});
	return [dropdown, activeOption, setActiveOption];
};
export const getProp = (obj, path) => {
	if (path.startsWith(".")) {
		return _.get(obj, path.slice(1));
	}
	return obj;
};
export const useSearchBar = ({ placeholder, expanded }) => {
	const [search, setSearch] = React.useState("");
	const searchProps = {
		filter: "",
		setFilter: f => setSearch(f),
	};
	const searchbar = /*#__PURE__*/ S.React.createElement(
		S.SpotifyReactContexts.FilterContext.Provider,
		{
			value: searchProps,
		},
		/*#__PURE__*/ S.React.createElement(S.ReactComponents.FilterBox, {
			alwaysExpanded: expanded,
			placeholder: placeholder,
		}),
	);
	return [searchbar, search];
};
export const useChipFilter = filters => {
	const [selectedFilterFullKey, setSelectedFilterFullKey] = React.useState(".");
	const selectedFilters = React.useMemo(
		() =>
			selectedFilterFullKey
				.split(".")
				.slice(1, -1)
				.reduce(
					(selectedFilters, selectedFilterFullKeyPart) => {
						const prevSelectedFilter = selectedFilters.at(-1);
						const selectedFilter = {
							key: `${prevSelectedFilter.key}${selectedFilterFullKeyPart}.`,
							filter: prevSelectedFilter.filter[selectedFilterFullKeyPart],
						};
						selectedFilters.push(selectedFilter);
						return selectedFilters;
					},
					[
						{
							key: ".",
							filter: filters,
						},
					],
				),
		[filters, selectedFilterFullKey],
	);
	const lastSelectedFilter = selectedFilters.at(-1);
	const availableFilters = [];
	for (const [k, v] of Object.entries(lastSelectedFilter.filter)) {
		if (k === "") continue;
		availableFilters.push({
			key: `${lastSelectedFilter.key}${k}.`,
			filter: v,
		});
	}
	const toggleFilter = React.useCallback(
		filter => setSelectedFilterFullKey(filter.key === selectedFilterFullKey ? "." : filter.key),
		[selectedFilterFullKey],
	);
	const hasFC = ({ filter }) => filter[""];
	const chipFilter = /*#__PURE__*/ S.React.createElement(ChipFilter, {
		selectedFilters: selectedFilters.filter(hasFC),
		availableFilters: availableFilters.filter(hasFC),
		toggleFilter: toggleFilter,
	});
	return [chipFilter, selectedFilters, selectedFilterFullKey, setSelectedFilterFullKey];
};
