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
import { REACT_FIBER, waitForElement } from "../dom.ts";
import { createIconComponent } from "../createIconComponent.tsx";
import { Platform } from "../../src/expose/Platform.ts";
import { Tooltip } from "../../src/webpack/ReactComponents.ts";
import { UI } from "../../src/webpack/ComponentLibrary.ts";

const SettingsIcon = () =>
	createIconComponent({
		semanticColor: "textSubdued",
		icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M24 13.616v-3.232c-1.651-.587-2.694-.752-3.219-2.019v-.001c-.527-1.271.1-2.134.847-3.707l-2.285-2.285c-1.561.742-2.433 1.375-3.707.847h-.001c-1.269-.526-1.435-1.576-2.019-3.219h-3.232c-.582 1.635-.749 2.692-2.019 3.219h-.001c-1.271.528-2.132-.098-3.707-.847l-2.285 2.285c.745 1.568 1.375 2.434.847 3.707-.527 1.271-1.584 1.438-3.219 2.02v3.232c1.632.58 2.692.749 3.219 2.019.53 1.282-.114 2.166-.847 3.707l2.285 2.286c1.562-.743 2.434-1.375 3.707-.847h.001c1.27.526 1.436 1.579 2.019 3.219h3.232c.582-1.636.75-2.69 2.027-3.222h.001c1.262-.524 2.12.101 3.698.851l2.285-2.286c-.744-1.563-1.375-2.433-.848-3.706.527-1.271 1.588-1.44 3.221-2.021zm-12 2.384c-2.209 0-4-1.791-4-4s1.791-4 4-4 4 1.791 4 4-1.791 4-4 4z"/></svg>',
	});

const History = Platform.getHistory();

interface SettingsButtonProps {
	section: string;
}

export default function ({ section }: SettingsButtonProps): React.ReactElement<HTMLButtonElement> {
	return (
		<Tooltip
			label="Settings"
			renderInline={true}
			placement="top"
		>
			<UI.ButtonTertiary
				buttonSize="sm"
				onClick={async () => {
					History.push("/preferences");
					const searchButton = await waitForElement(".O2vRz41OsAH0O7xVA4La .wCl7pMTEE68v1xuZeZiB");
					const recUp = (fiber: any): any => {
						const { type } = fiber;
						if (type.$$typeof === Symbol.for("react.provider") && type._context._currentValue.setFilter)
							return fiber;
						return recUp(fiber.return);
					};

					const filterContext = recUp((searchButton as any)[REACT_FIBER]);

					const { setFilter } = filterContext.pendingProps.value;
					setFilter(section);
				}}
				aria-label="Settings"
				iconOnly={SettingsIcon}
			/>
		</Tooltip>
	);
}
