/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { createIconComponent } from "../../lib/createIconComponent.tsx";
import { transformer } from "../../mix.ts";
import { Tooltip } from "../webpack/ReactComponents.ts";
import { UI } from "../webpack/ComponentLibrary.ts";
import { Registry } from "./registry.ts";

const registry = new Registry<React.ReactNode>();
export default registry;

declare global {
	var __renderNowPlayingWidgets: any;
}

globalThis.__renderNowPlayingWidgets = () => registry.all();
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(/(hideButtonFactory[^\]]*)/, "$1,...__renderNowPlayingWidgets()");

		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);

export type PlaybarWidgetProps = { label: string; icon?: string; onClick: () => void };
export const PlaybarWidget = ({ label, icon, onClick }: PlaybarWidgetProps) => (
	<Tooltip label={label}>
		<UI.ButtonTertiary
			size="small"
			className={undefined}
			aria-label={label}
			condensed={false}
			iconOnly={icon && (() => createIconComponent({ icon }))}
			onClick={onClick}
		/>
	</Tooltip>
);
