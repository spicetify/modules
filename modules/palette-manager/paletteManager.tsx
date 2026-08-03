/* Copyright (C) 2024 harbassan, and Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TopbarRightButton } from "/modules/stdlib/src/registers/topbarRightButton.tsx";
import Modal from "./modal.tsx";
import { React } from "/modules/stdlib/src/expose/React.ts";
import { display } from "/modules/stdlib/lib/modal.tsx";

export const EditButton = () => {
	return (
		<TopbarRightButton
			label="Palette Manager"
			// 1.5 round stroke matches the native encore topbar icon weight.
			icon='<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M11 2.5l2.5 2.5L6 12.5l-3.5 1 1-3.5L11 2.5z"/>'
			onClick={() => {
				display({
					title: "Palette Manager",
					content: <Modal />,
					isLarge: true,
				});
			}}
		/>
	);
};
