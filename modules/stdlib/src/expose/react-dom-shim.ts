/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// npm-style `import ... from "react-dom"` resolves here, forwarding to the
// client's own ReactDOM. Live bindings populated at capture time rather than
// init-time snapshots — see react-shim.ts for why a snapshot here freezes
// undefined for the whole session.

import { warn } from "../logger.ts";
import { onWebpackCaptured } from "../webpack/index.ts";
import { onFallbackRecovery, ReactDOM } from "./React.ts";

const RD = ReactDOM as any;

export default ReactDOM;

export let createPortal: any;
export let createRoot: any;
export let findDOMNode: any;
export let flushSync: any;
export let hydrate: any;
export let hydrateRoot: any;
export let render: any;
export let unmountComponentAtNode: any;
export let version: any;

function populate() {
	createPortal = RD.createPortal;
	createRoot = RD.createRoot;
	findDOMNode = RD.findDOMNode;
	flushSync = RD.flushSync;
	hydrate = RD.hydrate;
	hydrateRoot = RD.hydrateRoot;
	render = RD.render;
	unmountComponentAtNode = RD.unmountComponentAtNode;
	version = RD.version;
}

onWebpackCaptured(() => {
	populate();
	if (typeof createRoot !== "function") {
		warn(
			"[stdlib] capture health: the client ReactDOM was not found in the webpack capture — " +
				"named `react-dom` imports are degraded until the fallback loads",
		);
		onFallbackRecovery(populate);
	}
});
