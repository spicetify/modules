/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { createIconComponent } from "../createIconComponent.tsx";
import { transformer } from "../../mixin.ts";
import { Tooltip } from "../webpack/ReactComponents.ts";
import { UI } from "../webpack/ComponentLibrary.ts";
import { mountRegistryAnchor } from "./mount.ts";
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
	var __renderTopbarRightButtons: () => React.ReactNode;
}

globalThis.__renderTopbarRightButtons = () =>
	React.createElement(() => {
		[, refresh] = React.useReducer((n) => n + 1, 0);

		return <>{registry.all().reverse()}</>;
	});
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(/("login-button"[^\}]*\}[^\}]*\}[^\}]*\}\))/, "$1,__renderTopbarRightButtons()");

		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);

mountRegistryAnchor({
	className: "spicetify-topbar-right-buttons",
	registry,
	setRefresh: (cb) => {
		refresh = cb;
	},
	findSlot: () => {
		const actions = document.querySelector(".main-actionButtons");
		return actions ? { parent: actions, before: actions.firstChild } : null;
	},
});

type TopbarRightButtonProps = {
	label: string;
	disabled?: boolean;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	icon?: string;
	/** Position within the module-button group; lower renders earlier. Read by the mount sorter. */
	order?: number;
};

type TopbarRightButtonFactory = React.FC<TopbarRightButtonProps>;

export const TopbarRightButton: TopbarRightButtonFactory = (props) => (
	<Tooltip label={props.label}>
		<UI.ButtonTertiary
			aria-label={props.label}
			onClick={props.onClick}
			size="small"
			iconOnly={() => props.icon && createIconComponent({ icon: props.icon, iconSize: 16 })}
			className={MAP.main.topbar.right.button_t.wrapper}
		/>
	</Tooltip>
);
