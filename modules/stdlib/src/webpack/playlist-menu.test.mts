import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { findPlaylistMenu } from "./playlist-menu.ts";

// Structural fixtures: the menu action survives the playlist type's move to an enum.
function legacyMenuFactory() {
	return { value: "playlist", permissions: { canView: true }, label: "contextmenu.share.copy-playlist-link" };
}
function currentMenuFactory() {
	return { permissions: { canView: true }, label: "contextmenu.share.copy-playlist-link" };
}
function playlistMapper() {
	return { canPin: true, canView: true };
}
function platformFactory() {
	return { createPlatformDesktop: async () => ({ permissions: { canView: true }, canPin: true, canView: true }) };
}

const jsx = (type: unknown, props: unknown) => ({ type, props: { ...Object(props) } });
const innerMenu = () => null;
// Preserve the minified export shape from 1.2.97 and 1.3 without running client code.
const wrapper = vm.runInNewContext("e=>(0,r.jsx)(j,{...e})", { r: { jsx }, j: innerMenu });
const memo = { $$typeof: Symbol.for("react.memo"), type: wrapper };

describe("playlist menu discovery", () => {
	for (const [name, factory] of [
		["literal playlist type", legacyMenuFactory],
		["hoisted playlist type", currentMenuFactory],
	] as const) {
		it(`selects the JSX wrapper with a ${name}, ignoring capability factories`, () => {
			const required: PropertyKey[] = [];
			const result = findPlaylistMenu(
				[
					[1, playlistMapper],
					[2, platformFactory],
					[3, factory],
				],
				(id) => {
					required.push(id);
					return { helper: () => null, metadata: {}, W: wrapper };
				},
			);
			assert.equal(result, wrapper);
			assert.deepEqual(required, [3]);
			assert.deepEqual(wrapper({ uri: "spotify:playlist:test" }), {
				type: innerMenu,
				props: { uri: "spotify:playlist:test" },
			});
		});
	}

	it("accepts a memo or forward-ref component export", () => {
		for (const component of [memo, { $$typeof: Symbol.for("react.forward_ref"), render: wrapper }]) {
			assert.equal(
				findPlaylistMenu([[1, legacyMenuFactory]], () => ({ default: component })),
				component,
			);
		}
	});

	it("accepts a legacy component that renders the playlist actions directly", () => {
		function renderMenu() {
			return jsx(innerMenu, { label: "contextmenu.share.copy-playlist-link", permissions: { canView: true } });
		}
		for (const component of [renderMenu, { $$typeof: Symbol.for("react.memo"), type: renderMenu }]) {
			assert.equal(
				findPlaylistMenu([[1, legacyMenuFactory]], () => ({ W: component })),
				component,
			);
		}
	});

	it("does not require a factory on a miss", () => {
		for (const factories of [[], [[1, playlistMapper]]] as const) {
			assert.equal(
				findPlaylistMenu(factories, () => assert.fail("must not require an unverified factory")),
				undefined,
			);
		}
	});

	it("ignores a loaded library page that also contains playlist menu actions", () => {
		const libraryRoot = () => jsx(innerMenu, { children: jsx(innerMenu, {}) });
		assert.equal(
			findPlaylistMenu(
				[
					[1, currentMenuFactory],
					[2, legacyMenuFactory],
				],
				(id) => (id === 1 ? { YourLibraryX: libraryRoot } : { W: wrapper }),
			),
			wrapper,
		);
	});

	it("deduplicates export aliases but refuses distinct matching components", () => {
		assert.equal(
			findPlaylistMenu([[1, currentMenuFactory]], () => ({ first: wrapper, second: wrapper })),
			wrapper,
		);
		assert.equal(
			findPlaylistMenu(
				[
					[1, currentMenuFactory],
					[2, legacyMenuFactory],
				],
				(id) => ({ W: id === 1 ? wrapper : memo }),
			),
			undefined,
		);
	});

	it("rejects unrelated functions, plain objects, and async exports", () => {
		for (const exports of [
			null,
			undefined,
			() => null,
			{},
			{ value: {} },
			{ value: () => ({ canView: true }) },
			{ value: async () => jsx(innerMenu, {}) },
		]) {
			assert.equal(
				findPlaylistMenu([[1, currentMenuFactory]], () => exports),
				undefined,
			);
		}
	});

	it("refuses to choose the first of multiple renderable exports", () => {
		assert.equal(
			findPlaylistMenu([[1, currentMenuFactory]], () => ({ first: wrapper, second: memo })),
			undefined,
		);
	});

	it("does not trust a function's custom toString or an untagged type property", () => {
		const decoy = Object.assign(playlistMapper, { toString: () => String(currentMenuFactory) });
		assert.equal(
			findPlaylistMenu([[1, decoy]], () => ({ W: wrapper })),
			undefined,
		);
		assert.equal(
			findPlaylistMenu([[1, currentMenuFactory]], () => ({ W: { type: wrapper } })),
			undefined,
		);
	});
});
