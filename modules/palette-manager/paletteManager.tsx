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
			icon='<path d="M11.472.279L2.583 10.686l-.887 4.786 4.588-1.625L15.173 3.44 11.472.279zM5.698 12.995l-2.703.957.523-2.819v-.001l2.18 1.863zm-1.53-2.623l7.416-8.683 2.18 1.862-7.415 8.683-2.181-1.862z"/>'
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
