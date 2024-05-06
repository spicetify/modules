/* Copyright © 2024
 *      harbassan <harbassan@hotmail.com>
 *
 * This file is part of bespoke/modules/palette-manager.
 *
 * bespoke/modules/palette-manager is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * bespoke/modules/palette-manager is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with bespoke/modules/palette-manager. If not, see <https://www.gnu.org/licenses/>.
 */

import { S, SVGIcons } from "/modules/official/stdlib/index.js";

import { useSearchBar } from "/modules/official/stdlib/lib/components/index.js";
import paletteManager from "./paletteManager.js";
import { createIconComponent } from "/modules/official/stdlib/lib/createIconComponent.js";
import { startCase } from "/modules/official/stdlib/deps.js";

function isValidHex(hex: string) {
	const regex = /^#[0-9A-Fa-f]{6}$/;
	return regex.test(hex);
}

const Modal = () => {
	const [modalPalette, setModalPalette] = S.React.useState(paletteManager.getCurrPalette());
	const [palettes, setPalettes] = S.React.useState(paletteManager.getPalettes());
	const [searchbar, search] = useSearchBar({ placeholder: "Search Palettes", expanded: true });

	function setPalette(palette) {
		setModalPalette(palette);
		paletteManager.togglePalette(palette.name);
	}

	function updateField(name, value) {
		const newFields = { ...modalPalette.fields, [name]: value };
		setModalPalette({ ...modalPalette, fields: newFields });

		if (!isValidHex(value)) return;
		paletteManager.updateLocal(modalPalette.name, newFields);
	}

	function addPalette() {
		setPalette(paletteManager.createLocal({ name: "New Custom", fields: modalPalette.fields }));
		setPalettes(paletteManager.getPalettes());
	}

	function remPalette(palette) {
		paletteManager.deleteLocal(palette.name);
		setPalettes(paletteManager.getPalettes());
		setPalette(paletteManager.getPalette("def"));
	}

	function renamePalette(palette, newName) {
		paletteManager.renameLocal(palette.name, newName);
		setPalettes(paletteManager.getPalettes());
	}

	function copyObj() {
		const css = JSON.stringify(modalPalette);
		// @ts-ignore
		S.Platform.getClipboardAPI().copy(css);
	}

	const LocalInfo = () => {
		const [name, setName] = S.React.useState(modalPalette.name);

		return (
			<div className="palette-info">
				<input
					className="palette-name"
					readOnly={!modalPalette.local}
					placeholder="Custom Palette"
					value={modalPalette.local ? name : `${name} (static)`}
					onChange={e => setName(e.target.value)}
				/>
				{modalPalette.local && [
					<button type="button" key="delete" onClick={() => remPalette(modalPalette)}>
						Delete
					</button>,
					<button type="button" key="rename" onClick={e => renamePalette(modalPalette, name)}>
						Rename
					</button>,
				]}
				<button type="button" onClick={copyObj}>
					Copy Object
				</button>
			</div>
		);
	};

	const filteredPalettes = palettes.filter(palette => palette.name.toLowerCase().includes(search.toLowerCase()));

	return (
		<div className="palette-modal-container">
			<div className="palette-list-container">
				<ul>
					{searchbar}
					<S.ReactComponents.MenuItem
						leadingIcon={createIconComponent({
							icon: SVGIcons.plus2px,
						})}
						divider="after"
						onClick={addPalette}
					>
						Create New Palette
					</S.ReactComponents.MenuItem>
					<ul className="palette-list">
						{filteredPalettes.map(palette => (
							// biome-ignore lint/correctness/useJsxKeyInIterable: <explanation>
							<S.ReactComponents.MenuItem
								trailingIcon={
									palette.name === modalPalette.name &&
									createIconComponent({
										icon: SVGIcons.check,
									})
								}
								onClick={() => setPalette(palette)}
							>
								{palette.name}
							</S.ReactComponents.MenuItem>
						))}
					</ul>
				</ul>
			</div>
			<div className="palette-fields-container">
				<LocalInfo />
				<div className="palette-fields">
					{Object.entries(modalPalette.fields).map(([name, value]) => (
						<div key={name} className="input-row">
							<label>{startCase(name)}</label>
							<input className="color-input" type="color" value={value} onChange={e => updateField(name, e.target.value)} />
							<input className="text-input" type="text" value={value} onChange={e => updateField(name, e.target.value)} />
						</div>
					))}
				</div>
			</div>
		</div>
	);
};

export default Modal;
