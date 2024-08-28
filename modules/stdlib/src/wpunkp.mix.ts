export type WebpackRequire = {
	m: Chunk[1];
};

export type Module = Function;
export type Modules = Record<keyof any, Module>;
export type Chunk = [
	Array<keyof any>,
	Modules,
	(wpr: WebpackRequire) => void,
];

export let webpackRequire: WebpackRequire;

declare global {
	var __webpack_require__: WebpackRequire;
	var webpackChunkclient_web: Chunk[];
}

const webpackChunkclient_web = [[
	[Symbol.for("spicetify.webpack.chunk.id")],
	{},
	($: WebpackRequire) => {
		globalThis["__webpack_require__"] = webpackRequire = $;
	},
] as Chunk];

globalThis.webpackChunkclient_web = webpackChunkclient_web;
