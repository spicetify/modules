/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { createIconComponent } from "../../lib/createIconComponent.tsx";
import { transformer } from "../../mixin.ts";
import { Tooltip } from "../webpack/ReactComponents.ts";
import { UI } from "../webpack/ComponentLibrary.ts";
import { Registry } from "./registry.ts";

const registry = new (class extends Registry<React.ReactNode> {
	override add(value: React.ReactNode): this {
		refresh?.();
		return super.add(value);
	}

	override delete(value: React.ReactNode): boolean {
		refresh?.();
		return super.delete(value);
	}
})();
export default registry;

let refresh: React.DispatchWithoutAction | undefined;

declare global {
	var __renderTopbarLeftButtons: () => React.ReactNode;
}

globalThis.__renderTopbarLeftButtons = () =>
	React.createElement(() => {
		[, refresh] = React.useReducer((n) => n + 1, 0);

		return <>{registry.all()}</>;
	});
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(/("top-bar-forward-button"[^\]]*)/g, "$1,__renderTopbarLeftButtons()");

		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);

type TopbarLeftButtonProps = {
	label: string;
	disabled?: boolean;
	onClick: () => void;
	icon?: string;
};

type TopbarLeftButtonFactory = React.FC<TopbarLeftButtonProps>;
export const TopbarLeftButton: TopbarLeftButtonFactory = (props) => (
	<Tooltip label={props.label}>
		<UI.ButtonTertiary
			size="medium"
			iconOnly={() =>
				props.icon && createIconComponent({ icon: props.icon, iconSize: 16, realIconSize: 24 })}
			condensed
			aria-label={props.label}
			disabled={props.disabled}
			onClick={props.onClick}
			className={MAP.main.topbar.left.button_t.wrapper}
		/>
	</Tooltip>
);
