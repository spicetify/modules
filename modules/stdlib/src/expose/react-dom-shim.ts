/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// npm-style `import ... from "react-dom"` in module code resolves here
// (stitch aliases it), forwarding to the client's react-dom instance.

import { ReactDOM } from "./React.ts";

const RD = ReactDOM as any;

export default ReactDOM;

export const createPortal = RD.createPortal;
export const createRoot = RD.createRoot;
export const findDOMNode = RD.findDOMNode;
export const flushSync = RD.flushSync;
export const hydrate = RD.hydrate;
export const hydrateRoot = RD.hydrateRoot;
export const render = RD.render;
export const unmountComponentAtNode = RD.unmountComponentAtNode;
export const version = RD.version;
