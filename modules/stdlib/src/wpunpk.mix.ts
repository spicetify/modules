export type WebpackRequire = {
	m: Chunk[1];
	g: typeof globalThis;
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
		const globalThisShadow = createGlobalThisShadow();
		$.g = globalThisShadow;

		const $sendCosmosRequest = globalThis.sendCosmosRequest;
		Object.defineProperty(globalThisShadow, "sendCosmosRequest", {
			value: function ($) {
				try {
					const request = JSON.parse($.request);
					const { uri, method } = request;
					const body = JSON.parse(request.body);
					const { type, height } = body;

					if (
						uri === "sp://messages/v1/container/control" &&
						method === "POST" &&
						type === "update_titlebar"
					) {
						console.error(height);
					}
				} catch (e) {}

				return $sendCosmosRequest($);
			},
		});
	},
] as Chunk];

globalThis.webpackChunkclient_web = webpackChunkclient_web;

function createGlobalThisShadow() {
	const globalThisShadow = {} as typeof globalThis;

	Object.setPrototypeOf(globalThisShadow, globalThis);

	Object.defineProperty(globalThisShadow, "self", { value: globalThisShadow });
	Object.defineProperty(globalThisShadow, "globalThis", { value: globalThisShadow });
	Object.defineProperty(globalThisShadow, "window", { value: globalThisShadow });

	return globalThisShadow;
}
