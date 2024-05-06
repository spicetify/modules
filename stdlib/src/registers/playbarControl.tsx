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

import { Registry } from "./registry.js";
import { S } from "../expose/index.js";
import { createIconComponent } from "../../lib/createIconComponent.js";
import { registerTransform } from "../../mixin.js";

const registry = new Registry<React.ReactElement, void>();
export default registry;

globalThis.__renderPlaybarBarControls = registry.getItems.bind(registry, undefined, true);
registerTransform({
	transform: emit => str => {
		str = str.replace(/(children:\[)([^\[]*djJumpButtonFactory)/, "$1...__renderPlaybarBarControls(),$2");
		emit();
		return str;
	},
	glob: /^\/xpui\.js/,
});

export type PlaybarBarControlProps = {
	label: string;
	isActive?: boolean;
	isActiveNoIndicator?: boolean;
	disabled?: boolean;
	icon?: string;
	onClick: () => void;
};
export const PlaybarBarControl = ({
	label,
	isActive = false,
	isActiveNoIndicator = false,
	disabled = false,
	icon,
	onClick,
}: PlaybarBarControlProps) => {
	const [_isActive, _setIsActive] = S.React.useState(isActive);

	return (
		<S.ReactComponents.Tooltip label={label}>
			<S.ReactComponents.UI.ButtonTertiary
				aria-label={label}
				size="small"
				className={`main-genericButton-button ${_isActive || isActiveNoIndicator ? "main-genericButton-buttonActive" : ""} ${
					_isActive ? "main-genericButton-buttonActiveDot" : ""
				}`}
				disabled={disabled}
				iconOnly={icon && (() => createIconComponent({ icon }))}
				onClick={() => {
					onClick();
					_setIsActive(!_isActive);
				}}
				data-active={_isActive.toString()}
				aria-pressed={_isActive}
			/>
		</S.ReactComponents.Tooltip>
	);
};