/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../src/expose/React.ts";
import { UI } from "../src/webpack/ComponentLibrary.ts";

export const createIconComponent = ({
	icon,
	iconSize = 16,
	realIconSize = iconSize,
	...props
}: {
	[k: string]: any;
	icon: string;
	realIconSize?: number;
	iconSize?: number;
}) => {
	return (
		<UI.Icon
			autoMirror={false}
			iconSize={realIconSize}
			viewBox={`0 0 ${iconSize} ${iconSize}`}
			dangerouslySetInnerHTML={{ __html: icon }}
			{...props}
		/>
	);
};
