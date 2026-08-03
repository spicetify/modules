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
			icon='<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M11.6 1.3l2.9 2.5-8.6 10-3.6 1.3.7-3.8 8.6-10z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4.9 10.6l2.6 2.2"/>'
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
