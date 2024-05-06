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

import { S } from "../../index.js";
import { isTouchscreenUi } from "../../src/utils/index.js";
const { ReactDOM } = S;

const NavToChip = ({ to, title, selected, onClick }) => (
	<S.ReactComponents.NavTo replace={true} to={to} tabIndex={-1} onClick={onClick} className="ZWI7JsjzJaR_G8Hy4W6J">
		<S.ReactComponents.UI.Chip selected={selected} selectedColorSet="invertedLight" tabIndex={-1}>
			{title}
		</S.ReactComponents.UI.Chip>
	</S.ReactComponents.NavTo>
);

export interface NavBarProps {
	namespace: string;
	categories: string[];
	selectedCategory: string;
}
const NavBar = ({ namespace, categories, selectedCategory }: NavBarProps) => (
	<div className="fVB_YDdnaDlztX7CcWTA">
		<div className="e179_Eg8r7Ub6yjjxctr contentSpacing">
			<div className="VIeVCUUETJyYPCDpsBif">
				<S.ReactComponents.ScrollableContainer>
					{categories.map(category => (
						<NavToChip to={`spotify:app:bespoke:${namespace}:${category}`} title={category} selected={category === selectedCategory}>
							{category}
						</NavToChip>
					))}
				</S.ReactComponents.ScrollableContainer>
			</div>
		</div>
	</div>
);

const TopBarMounted = ({ children }) => {
	const touchscreenUi = isTouchscreenUi();

	const component = (
		<div className="main-topbar-topbarContent" style={{ pointerEvents: "all" }}>
			{children}
		</div>
	);

	return touchscreenUi ? component : ReactDOM.createPortal(component, document.querySelector(".main-topBar-topbarContentWrapper"));
};

export const TopNavBar = (props: NavBarProps) => (
	<TopBarMounted>
		<NavBar {...props} />
	</TopBarMounted>
);
