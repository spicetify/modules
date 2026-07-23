/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { createIconComponent } from "../../lib/createIconComponent.tsx";
import { transformer } from "../../mixin.ts";
import { Tooltip } from "../webpack/ReactComponents.ts";
import { UI } from "../webpack/ComponentLibrary.ts";
import { classnames } from "../webpack/ClassNames.ts";
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
	var __renderPlaybarBarControls: any;
}

globalThis.__renderPlaybarBarControls = () => registry.all().reverse();
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(
			/(children:\[)([^\[]*djJumpButtonFactory)/,
			"$1...__renderPlaybarBarControls(),$2",
		);

		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);

mountRegistryAnchor({
	className: "spicetify-playbar-buttons",
	registry,
	setRefresh: (cb) => {
		refresh = cb;
	},
	findSlot: () => {
		const controls = document.querySelector(".main-nowPlayingBar-extraControls");
		return controls ? { parent: controls, before: controls.firstChild } : null;
	},
});

export type PlaybarButtonProps = {
	label: string;
	isActive?: boolean;
	isActiveNoIndicator?: boolean;
	disabled?: boolean;
	icon?: string;
	onClick: () => void;
};
export const PlaybarButton = ({
	label,
	isActive = false,
	isActiveNoIndicator = false,
	disabled = false,
	icon,
	onClick,
}: PlaybarButtonProps) => (
	<Tooltip label={label}>
		<UI.ButtonTertiary
			aria-label={label}
			size="small"
			className={classnames(MAP.main.playbar.buttons.button.wrapper, {
				[MAP.main.playbar.buttons.button.wrapper__indicator]: isActive,
				[MAP.main.playbar.buttons.button.wrapper__active]: isActive || isActiveNoIndicator,
			})}
			disabled={disabled}
			iconOnly={icon && (() => createIconComponent({ icon }))}
			onClick={onClick}
			data-active={isActive.toString()}
			aria-pressed={isActive}
		/>
	</Tooltip>
);
