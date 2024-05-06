/* Copyright © 2024
 *      Delusoire <deluso7re@outlook.com>
 *
 * This file is part of bespoke/modules/stdlib.
 *
 * bespoke/modules/stdlib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * bespoke/modules/stdlib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with bespoke/modules/stdlib. If not, see <https://www.gnu.org/licenses/>.
 */

import { type Predicate, Registry } from "./registry.js";
import { S } from "../expose/index.js";
import { createIconComponent } from "../../lib/createIconComponent.js";
import { registerTransform } from "../../mixin.js";
import { isTouchscreenUi } from "../utils/index.js";

const registry = new (class extends Registry<React.FC, void> {
	register(item: React.FC, predicate: Predicate<void>): React.FC {
		super.register(item, predicate);
		refreshTopbarRightButtons?.();
		return item;
	}

	unregister(item: React.FC): React.FC {
		super.unregister(item);
		refreshTopbarRightButtons?.();
		return item;
	}
})();
export default registry;

let refreshTopbarRightButtons: React.DispatchWithoutAction | undefined;

let topbarRightButtonFactoryCtx: React.Context<React.FC<TopbarRightButtonProps>>;
globalThis.__renderTopbarRightButtons = () =>
	S.React.createElement(() => {
		const [refreshCount, refresh] = S.React.useReducer(x => x + 1, 0);
		refreshTopbarRightButtons = refresh;

		const topbarRightButtonFactory = isTouchscreenUi() ? TopbarRightButtonRound : TopbarRightButtonSquare;

		if (!topbarRightButtonFactoryCtx) topbarRightButtonFactoryCtx = S.React.createContext<React.FC<TopbarRightButtonProps> | null>(null);

		return (
			<topbarRightButtonFactoryCtx.Provider value={topbarRightButtonFactory}>
				{registry.getItems(undefined, true).map(TopbarRightButton => (
					<TopbarRightButton />
				))}
			</topbarRightButtonFactoryCtx.Provider>
		);
	});
registerTransform({
	transform: emit => str => {
		str = str.replace(/("login-button"[^\}]*\}[^\}]*\}[^\}]*\}\))/, "$1,__renderTopbarRightButtons()");
		emit();
		return str;
	},
	glob: /^\/xpui\.js/,
});

type TopbarRightButtonProps = { label: string; disabled?: boolean; onClick: () => void; icon?: string };
export const Button = (props: TopbarRightButtonProps) => {
	const TopbarRightButtonFactory = S.React.useContext(topbarRightButtonFactoryCtx);
	return TopbarRightButtonFactory && <TopbarRightButtonFactory {...props} />;
};

const TopbarRightButtonRound = ({ label, disabled = false, onClick, icon }: TopbarRightButtonProps) => {
	<S.ReactComponents.Tooltip label={label}>
		<S.ReactComponents.UI.ButtonTertiary aria-label={label} onClick={onClick} size="small" condensedAll className="OomFKn3bsxs5JfNUoWhz">
			{icon && createIconComponent({ icon, iconSize: 16, realIconSize: 24 })}
		</S.ReactComponents.UI.ButtonTertiary>
	</S.ReactComponents.Tooltip>;
};

const TopbarRightButtonSquare = ({ label, disabled = false, onClick, icon }: TopbarRightButtonProps) => (
	<S.ReactComponents.Tooltip label={label}>
		<button aria-label={label} className="encore-over-media-set WtC1lGbmQRplD6JBhNFU" onClick={onClick} disabled={disabled}>
			{icon && createIconComponent({ icon, iconSize: 16 })}
		</button>
	</S.ReactComponents.Tooltip>
);
