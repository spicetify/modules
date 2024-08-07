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
import { UI } from "../../src/webpack/ComponentLibrary.xpui.ts";
import { ReactDOM } from "../../src/webpack/React.xpui.ts";
import { NavTo, ScrollableContainer } from "../../src/webpack/ReactComponents.xpui.ts";
import { isGlobalNavBarEnabled } from "../../src/utils/index.ts";

interface NavToChipProps {
	to: string;
	title: string;
	selected: boolean;
	onClick: () => void;
}
const NavToChip: React.FC<NavToChipProps> = (props) => (
	<NavTo
		replace={true}
		to={props.to}
		tabIndex={-1}
		onClick={props.onClick}
		className={MAP.search_chips.chip}
	>
		<UI.Chip
			selected={props.selected}
			selectedColorSet="invertedLight"
			tabIndex={-1}
		>
			{props.title}
		</UI.Chip>
	</NavTo>
);

export interface NavBarProps {
	namespace: string;
	categories: string[];
	selectedCategory: string;
}
const NavBar = ({ namespace, categories, selectedCategory }: NavBarProps) => (
	<div className={MAP.search_chips.wrapper_wrapper}>
		<div className={`${MAP.search_chips.wrapper} contentSpacing`}>
			<div className={MAP.search_chips.container}>
				<ScrollableContainer>
					{categories.map((category) => (
						<NavToChip
							to={`spotify:app:bespoke:${namespace}:${category}`}
							title={category}
							selected={category === selectedCategory}
						>
							{category}
						</NavToChip>
					))}
				</ScrollableContainer>
			</div>
		</div>
	</div>
);

interface TopBarMountedProps {
	children?: React.ReactNode;
}
const TopBarMounted: React.FC<TopBarMountedProps> = (props) => {
	const children = (
		<div
			className="qHWqOt_TYlFxiF0Dm2fD"
			style={{ pointerEvents: "all" }}
		>
			{props.children}
		</div>
	);

	return isGlobalNavBarEnabled()
		? children
		: ReactDOM.createPortal(children, document.querySelector(".rovbQsmAS_mwvpKHaVhQ")!);
};

export const TopNavBar = (props: NavBarProps) => (
	<TopBarMounted>
		<NavBar {...props} />
	</TopBarMounted>
);
