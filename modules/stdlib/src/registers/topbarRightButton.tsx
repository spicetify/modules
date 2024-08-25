/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../expose/React.ts";
import { createIconComponent } from "../../lib/createIconComponent.tsx";
import { transformer } from "../../mix.ts";
import { isGlobalNavBarEnabled } from "../utils/index.ts";
import { Tooltip } from "../webpack/ReactComponents.ts";
import { UI } from "../webpack/ComponentLibrary.ts";
import { classnames } from "../webpack/ClassNames.ts";
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
	var __renderTopbarRightButtons: any;
}

let topbarRightButtonFactoryCtx: React.Context<React.FC<TopbarRightButtonProps>>;
globalThis.__renderTopbarRightButtons = () =>
	React.createElement(() => {
		[, refresh] = React.useReducer((n) => n + 1, 0);

		const topbarRightButtonFactory = isGlobalNavBarEnabled() ? _TopbarRightButtonT : _TopbarRightButton;

		if (!topbarRightButtonFactoryCtx) {
			topbarRightButtonFactoryCtx = React.createContext<TopbarRightButtonFactory>(null!);
		}

		return (
			<topbarRightButtonFactoryCtx.Provider value={topbarRightButtonFactory}>
				{registry.all().reverse()}
			</topbarRightButtonFactoryCtx.Provider>
		);
	});
transformer(
	(emit) => (str) => {
		emit();

		str = str.replace(
			/("login-button"[^\}]*\}[^\}]*\}[^\}]*\}\))/,
			"$1,__renderTopbarRightButtons()",
		);

		return str;
	},
	{
		glob: /^\/xpui\.js/,
	},
);

type TopbarRightButtonProps = {
	label: string;
	disabled?: boolean;
	onClick: () => void;
	icon?: string;
};
export const TopbarRightButton = (props: TopbarRightButtonProps) => {
	const TopbarRightButtonFactory = React.useContext(topbarRightButtonFactoryCtx);
	return TopbarRightButtonFactory && <TopbarRightButtonFactory {...props} />;
};

type TopbarRightButtonFactory = React.FC<TopbarRightButtonProps>;

const _TopbarRightButtonT: TopbarRightButtonFactory = (props) => (
	<Tooltip label={props.label}>
		<UI.ButtonTertiary
			aria-label={props.label}
			onClick={props.onClick}
			size="small"
			condensedAll
			className={MAP.main.topbar.right.button_t.wrapper}
		>
			{props.icon && createIconComponent({ icon: props.icon, iconSize: 16, realIconSize: 24 })}
		</UI.ButtonTertiary>
	</Tooltip>
);

const _TopbarRightButton: TopbarRightButtonFactory = (props) => (
	<Tooltip label={props.label}>
		<button
			aria-label={props.label}
			className={classnames("encore-over-media-set", MAP.main.topbar.right.button.wrapper)}
			onClick={props.onClick}
			disabled={props.disabled}
		>
			{props.icon && createIconComponent({ icon: props.icon, iconSize: 16 })}
		</button>
	</Tooltip>
);
