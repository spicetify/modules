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

import { S } from "../src/expose/index.js";

const { Locale } = S;
const { GenericModal } = S.ReactComponents;
const { Text } = S.ReactComponents.UI;

import RootRegistry from "../src/registers/root.js";
import { createIconComponent } from "./createIconComponent.js";

let close: (() => void) | undefined = undefined;
let ref: React.ReactElement | undefined = undefined;

export function display({
	title: contentLabel,
	content: children,
	isLarge: isEmbedWidgetGeneratorOrTrackCreditsModal,
}: {
	title: string;
	content: React.ReactElement;
	isLarge: boolean;
}) {
	hide();

	const PopupModal = () => {
		const [isOpen, setIsOpen] = S.React.useState(true);

		close = () => setIsOpen(false);

		if (isEmbedWidgetGeneratorOrTrackCreditsModal) {
			return (
				<GenericModal isOpen={isOpen} contentLabel={contentLabel}>
					<div className="uUYNnjSt8m3EqVjsnHgh" style={{ overflow: "scroll", width: "60vw" }}>
						<div className="bOIRpQiHUAEfp8ntStTo">
							<Text as="h1" variant="titleSmall">
								{contentLabel}
							</Text>
							<button className="oBoIIlKrwQjxXpvOiOa0" onClick={close}>
								{createIconComponent({
									icon: "<path d='M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06Z'/>",
									"aria-label": Locale.get("close"),
								})}
							</button>
						</div>
						<div className="IJHNf0vxPSbPE1egoG4N">{children}</div>
					</div>
				</GenericModal>
			);
		}

		return (
			<GenericModal isOpen={isOpen} contentLabel={contentLabel}>
				<div className="uV8q95GGAb2VDtL3gpYa">
					<div className="pGU_qEtNT1qWKjrRbvan">
						<Text as="h1" variant="titleMedium">
							{contentLabel}
						</Text>
						<button className="VKCcyYujazVPj6VkksPM" aria-label={Locale.get("close")} onClick={close}>
							{createIconComponent({
								icon: "<path d='M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06Z'/>",
								"aria-label": Locale.get("close"),
								iconSize: 18,
							})}
						</button>
					</div>
					<div className="Nw1INlIyra3LT1JjvoqH">{children}</div>
				</div>
			</GenericModal>
		);
	};
	ref = S.React.createElement(PopupModal);
	RootRegistry.register(ref, () => true);
}

export function hide() {
	close?.();
	ref && RootRegistry.unregister(ref);
}
