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
import { UI } from "../../src/webpack/ComponentLibrary.ts";
import { ScrollableContainer } from "../../src/webpack/ReactComponents.ts";
import { TreeNodeVal, type RFilterOpt } from "./index.tsx";

export interface ChipFilterProps {
	availableFilters: RFilterOpt[];
	selectedFilters: RFilterOpt[];
	toggleFilter: (filter: RFilterOpt) => void;
	className?: string;
}
export const ChipFilter = React.memo(
	({ availableFilters, selectedFilters, toggleFilter, className }: ChipFilterProps) => {
		const createChip = (isSelected: boolean) => (filter: RFilterOpt, index: number) =>
		(
			<UI.Chip
				onClick={() => toggleFilter(filter)}
				selectedColorSet="invertedLight"
				selected={isSelected}
				secondary={isSelected && index > 0}
				style={{ marginBlockEnd: 0, willChange: "transform, opacity" }}
				tabIndex={-1}
				index={index}
				key={filter.key}
			>
				{filter.filter[TreeNodeVal]}
			</UI.Chip>
		);

		return (
			selectedFilters.length + availableFilters.length > 0 && (
				<ScrollableContainer
					className={className}
					ariaLabel={"Filter options"}
				>
					{selectedFilters.map(createChip(true))}
					{availableFilters.map(createChip(false))}
				</ScrollableContainer>
			)
		);
	},
);
