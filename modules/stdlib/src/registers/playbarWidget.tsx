/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { createIconComponent } from "../createIconComponent.tsx";
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

mountRegistryAnchor({
	className: "spicetify-playbar-widgets",
	registry,
	setRefresh: (cb) => {
		refresh = cb;
	},
	findSlot: () => {
		const left = document.querySelector(".main-nowPlayingBar-left");
		return left ? { parent: left } : null;
	},
});

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
