/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, ReactDOM } from "../expose/React.ts";
import { createItemBoundary } from "./mount.ts";
import { Registry } from "./registry.ts";
import {
	createPanelCoordinator,
	type PanelController,
	type PanelCoordinator,
	type PanelRegistration,
} from "./panel-logic.ts";

export type { PanelController, PanelRegistration, PanelWidth } from "./panel-logic.ts";

const mountReactPanel = (host: HTMLElement, panel: PanelRegistration<React.ReactNode>, close: () => void) => {
	const root = ReactDOM.createRoot(host);
	const PanelBoundary = createItemBoundary(React, "panel") as unknown as React.ComponentType<{
		children?: React.ReactNode;
	}>;
	const PanelContent = () => React.createElement("div", { className: "spicetify-panel-content" }, panel.render());
	const PanelSurface = () =>
		React.createElement(
			React.Fragment,
			null,
			React.createElement(
				"header",
				{ className: "spicetify-panel-header" },
				React.createElement("h2", { className: "spicetify-panel-title" }, panel.label),
				React.createElement(
					"button",
					{
						className: "spicetify-panel-close spicetify-button-circle",
						"aria-label": `Close ${panel.label}`,
						onClick: close,
					},
					"×",
				),
			),
			React.createElement(PanelBoundary, null, React.createElement(PanelContent)),
		);
	root.render(React.createElement(PanelSurface));
	return () => root.unmount();
};

const panelCoordinatorKey = Symbol.for("spicetify.stdlib.panel-coordinator");
const shared = globalThis as typeof globalThis & Record<symbol, unknown>;
const previousCoordinator = shared[panelCoordinatorKey] as PanelCoordinator<React.ReactNode> | undefined;
previousCoordinator?.dispose();

export const panelCoordinator = createPanelCoordinator<React.ReactNode>({
	document,
	window,
	mount: mountReactPanel,
});
shared[panelCoordinatorKey] = panelCoordinator;

class PanelRegistry extends Registry<PanelRegistration<React.ReactNode>> {
	private controllers = new Map<PanelRegistration<React.ReactNode>, PanelController>();

	override add(panel: PanelRegistration<React.ReactNode>): this {
		this.controllers.set(panel, panelCoordinator.register(panel));
		return super.add(panel);
	}

	override delete(panel: PanelRegistration<React.ReactNode>): boolean {
		this.controllers.get(panel)?.dispose();
		this.controllers.delete(panel);
		return super.delete(panel);
	}

	controller(panel: PanelRegistration<React.ReactNode>): PanelController | undefined {
		return this.controllers.get(panel);
	}
}

export default new PanelRegistry();
