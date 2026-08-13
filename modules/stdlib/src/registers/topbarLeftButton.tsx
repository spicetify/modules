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

mountRegistryAnchor({
	className: "spicetify-topbar-left-buttons",
	registry,
	setRefresh: (cb) => {
		refresh = cb;
	},
	findSlot: () => {
		const history = document.querySelector(".main-globalNav-historyButtons");
		return history?.parentElement ? { parent: history.parentElement, before: history.nextSibling } : null;
	},
});

type TopbarLeftButtonProps = {
	label: string;
	disabled?: boolean;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	icon?: string;
	/** Position within the module-button group; lower renders earlier. Read by the mount sorter. */
	order?: number;
};

type TopbarLeftButtonFactory = React.FC<TopbarLeftButtonProps>;
export const TopbarLeftButton: TopbarLeftButtonFactory = (props) => (
	<Tooltip label={props.label}>
		<UI.ButtonTertiary
			size="medium"
			iconOnly={() => props.icon && createIconComponent({ icon: props.icon, iconSize: 16, realIconSize: 24 })}
			condensed
			aria-label={props.label}
			disabled={props.disabled}
			onClick={props.onClick}
			className={MAP.main.topbar.left.button_t.wrapper}
		/>
	</Tooltip>
);
