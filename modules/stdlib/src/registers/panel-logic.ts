/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface PanelWidth {
	default?: number;
	min?: number;
	max?: number;
}

export interface PanelRegistration<Content = unknown> {
	id: string;
	label: string;
	render: () => Content;
	width?: PanelWidth;
	onOpen?: () => void;
	onClose?: () => void;
}

export interface PanelController {
	open(): void;
	close(): void;
	toggle(): void;
	isOpen(): boolean;
	subscribe(listener: (open: boolean) => void): () => void;
	dispose(): void;
}

export interface PanelCoordinatorOptions<Content = unknown> {
	document: Document;
	window: Window;
	mount(host: HTMLElement, panel: PanelRegistration<Content>, close: () => void): () => void;
}

export interface PanelCoordinator<Content = unknown> {
	register(panel: PanelRegistration<Content>): PanelController;
	dispose(): void;
}

type RegistrationState<Content> = {
	panel: PanelRegistration<Content>;
	disposed: boolean;
	listeners: Set<(open: boolean) => void>;
};

type NativeSnapshot = { hidden: string | null; inert: string | null };
type StyleSnapshot = { value: string; priority: string };

const WIDTH_DEFAULT = 360;
const WIDTH_MIN = 280;
const WIDTH_MAX = 520;

const panelWidth = ({ width }: PanelRegistration): number => {
	const min = width?.min ?? WIDTH_MIN;
	const max = Math.max(min, width?.max ?? WIDTH_MAX);
	return Math.min(max, Math.max(min, width?.default ?? WIDTH_DEFAULT));
};

const validatePanelWidth = (width: PanelWidth | undefined) => {
	if (!width) return;
	for (const key of ["default", "min", "max"] as const) {
		const value = width[key];
		if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
			throw new Error(`[stdlib] panel width ${key} must be a finite non-negative number`);
		}
	}
};

const gridTracks = (template: string): string[] => {
	const tracks: string[] = [];
	let token = "";
	let parentheses = 0;
	let brackets = 0;
	for (const character of template.trim()) {
		if (/\s/.test(character) && parentheses === 0 && brackets === 0) {
			if (token) tracks.push(token);
			token = "";
			continue;
		}
		token += character;
		if (character === "(") parentheses += 1;
		else if (character === ")") parentheses -= 1;
		else if (character === "[") brackets += 1;
		else if (character === "]") brackets -= 1;
	}
	if (token) tracks.push(token);
	return tracks.filter((track) => !(track.startsWith("[") && track.endsWith("]")));
};

export function createPanelCoordinator<Content = unknown>(options: PanelCoordinatorOptions<Content>) {
	const registrations = new Map<string, RegistrationState<Content>>();
	const suspended = new Map<HTMLElement, NativeSnapshot>();
	const ownedStyles = new Map<HTMLElement, Map<string, StyleSnapshot>>();
	let active: RegistrationState<Content> | undefined;
	let activeHost: HTMLElement | undefined;
	let activeSidebar: HTMLElement | undefined;
	let activeTopContainer: HTMLElement | undefined;
	let unmount: (() => void) | undefined;
	let shellObserver: MutationObserver | undefined;
	let sidebarObserver: MutationObserver | undefined;
	let returnFocus: HTMLElement | undefined;
	let disposed = false;
	let transitioning = false;
	const transitions: Array<() => void> = [];
	const Observer = (options.window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;

	const safely = (label: string, callback: (() => void) | undefined) => {
		if (!callback) return;
		try {
			callback();
		} catch (error) {
			console.error(`[stdlib] panel ${label} failed:`, error);
		}
	};

	const notify = (state: RegistrationState<Content>, open: boolean) => {
		for (const listener of state.listeners) safely("subscriber", () => listener(open));
	};

	const transition = (action: () => void) => {
		transitions.push(action);
		if (transitioning) return;
		transitioning = true;
		let firstError: unknown;
		try {
			let next: (() => void) | undefined;
			while ((next = transitions.shift())) {
				try {
					next();
				} catch (error) {
					firstError ??= error;
				}
			}
		} finally {
			transitioning = false;
		}
		if (firstError) throw firstError;
	};

	const restoreNative = () => {
		for (const [element, snapshot] of suspended) {
			for (const attribute of ["hidden", "inert"] as const) {
				const value = snapshot[attribute];
				if (value === null) element.removeAttribute(attribute);
				else element.setAttribute(attribute, value);
			}
		}
		suspended.clear();
	};

	const setOwnedStyle = (element: HTMLElement, property: string, value: string) => {
		let snapshots = ownedStyles.get(element);
		if (!snapshots) {
			snapshots = new Map();
			ownedStyles.set(element, snapshots);
		}
		if (!snapshots.has(property)) {
			snapshots.set(property, {
				value: element.style.getPropertyValue(property),
				priority: element.style.getPropertyPriority(property),
			});
		}
		element.style.setProperty(property, value, "important");
	};

	const restoreOwnedStyles = (element: HTMLElement | undefined) => {
		if (!element) return;
		const snapshots = ownedStyles.get(element);
		if (!snapshots) return;
		for (const [property, snapshot] of snapshots) {
			if (snapshot.value) element.style.setProperty(property, snapshot.value, snapshot.priority);
			else element.style.removeProperty(property);
		}
		ownedStyles.delete(element);
	};

	const suspendNative = (sidebar: HTMLElement) => {
		for (const child of sidebar.children) {
			if (!(child instanceof HTMLElement) || child === activeHost) continue;
			if (!suspended.has(child)) {
				suspended.set(child, { hidden: child.getAttribute("hidden"), inert: child.getAttribute("inert") });
			}
			child.setAttribute("hidden", "");
			child.setAttribute("inert", "");
		}
	};

	const observeSidebar = (sidebar: HTMLElement) => {
		sidebarObserver?.disconnect();
		sidebarObserver = new Observer(() => suspendNative(sidebar));
		sidebarObserver.observe(sidebar, { childList: true });
	};

	const clearLayout = () => {
		activeTopContainer?.removeAttribute("data-spicetify-panel-active");
		restoreOwnedStyles(activeTopContainer);
		restoreOwnedStyles(activeSidebar);
		activeTopContainer = undefined;
		activeSidebar = undefined;
	};

	const placeActiveHost = (): boolean => {
		if (!active || !activeHost) return false;
		const sidebar = options.document.querySelector<HTMLElement>(".Root__right-sidebar");
		const topContainer = options.document.querySelector<HTMLElement>(".Root__top-container");
		if (!sidebar || !topContainer) return false;

		if (activeSidebar !== sidebar) {
			restoreNative();
			restoreOwnedStyles(activeSidebar);
			activeSidebar = sidebar;
			observeSidebar(sidebar);
		}
		if (activeHost.parentElement !== sidebar) sidebar.prepend(activeHost);
		if (activeTopContainer !== topContainer) {
			activeTopContainer?.removeAttribute("data-spicetify-panel-active");
			restoreOwnedStyles(activeTopContainer);
			activeTopContainer = topContainer;
		}
		topContainer.dataset.spicetifyPanelActive = "";
		const trailingTracks = gridTracks(options.window.getComputedStyle(topContainer).gridTemplateColumns).slice(3);
		const trailingWidth = trailingTracks.reduce(
			(total, track) => total + (track.endsWith("px") ? Number.parseFloat(track) || 0 : 0),
			0,
		);
		setOwnedStyle(topContainer, "--spicetify-panel-requested-width", `${panelWidth(active.panel)}px`);
		setOwnedStyle(topContainer, "--spicetify-panel-trailing-width", `${trailingWidth}px`);
		setOwnedStyle(
			topContainer,
			"grid-template-columns",
			["auto", "minmax(0, 1fr)", "var(--spicetify-panel-width)", ...trailingTracks].join(" "),
		);
		setOwnedStyle(sidebar, "width", "var(--spicetify-panel-width)");
		setOwnedStyle(sidebar, "min-width", "var(--spicetify-panel-width)");
		suspendNative(sidebar);
		return true;
	};

	const closeActive = (restoreFocus: boolean) => {
		const closing = active;
		if (!closing) return;
		active = undefined;
		shellObserver?.disconnect();
		shellObserver = undefined;
		sidebarObserver?.disconnect();
		sidebarObserver = undefined;
		safely("unmount", unmount);
		unmount = undefined;
		activeHost?.remove();
		activeHost = undefined;
		restoreNative();
		clearLayout();
		safely("onClose", closing.panel.onClose);
		notify(closing, false);
		if (restoreFocus) {
			if (returnFocus?.isConnected) returnFocus.focus();
			returnFocus = undefined;
		}
	};

	const open = (state: RegistrationState<Content>) => {
		if (disposed || state.disposed) return;
		if (active === state) return;
		const replacing = !!active;
		if (replacing) closeActive(false);
		const focused = options.document.activeElement;
		if (!replacing) returnFocus = focused instanceof HTMLElement ? focused : undefined;
		active = state;
		activeHost = options.document.createElement("section");
		activeHost.className = "spicetify-panel-host";
		activeHost.dataset.panelId = state.panel.id;
		activeHost.setAttribute("role", "complementary");
		activeHost.setAttribute("aria-label", state.panel.label);
		activeHost.tabIndex = -1;
		try {
			unmount = options.mount(activeHost, state.panel, () => transition(() => closeActive(true)));
		} catch (error) {
			active = undefined;
			activeHost.remove();
			activeHost = undefined;
			if (returnFocus?.isConnected) returnFocus.focus();
			returnFocus = undefined;
			throw error;
		}
		placeActiveHost();
		shellObserver = new Observer(() => {
			if (activeHost?.isConnected && activeSidebar?.isConnected && activeTopContainer?.isConnected) return;
			placeActiveHost();
		});
		if (options.document.body) shellObserver.observe(options.document.body, { childList: true, subtree: true });
		safely("onOpen", state.panel.onOpen);
		notify(state, true);
		activeHost.focus();
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape" || event.defaultPrevented || !active) return;
		if (
			options.document.querySelector(
				".spicetify-popover, .spicetify-scrim, .spicetify-root-children [role='dialog']",
			)
		)
			return;
		event.preventDefault();
		transition(() => closeActive(true));
	};
	options.document.addEventListener("keydown", onKeyDown);

	const register = (panel: PanelRegistration<Content>): PanelController => {
		if (disposed) throw new Error("[stdlib] panel coordinator is disposed");
		if (!panel.id.trim()) throw new Error("[stdlib] panel id must not be empty");
		if (!panel.label.trim()) throw new Error("[stdlib] panel label must not be empty");
		validatePanelWidth(panel.width);
		if (registrations.has(panel.id)) throw new Error(`[stdlib] duplicate panel id: ${panel.id}`);
		const state: RegistrationState<Content> = { panel, disposed: false, listeners: new Set() };
		registrations.set(panel.id, state);

		return {
			open: () => {
				if (disposed || state.disposed) throw new Error(`[stdlib] panel "${state.panel.id}" is disposed`);
				transition(() => open(state));
			},
			close: () => {
				transition(() => {
					if (active === state) closeActive(true);
				});
			},
			toggle: () => {
				if (disposed || state.disposed) throw new Error(`[stdlib] panel "${state.panel.id}" is disposed`);
				transition(() => {
					if (active === state) closeActive(true);
					else open(state);
				});
			},
			isOpen: () => active === state,
			subscribe(listener) {
				if (state.disposed) throw new Error(`[stdlib] panel "${state.panel.id}" is disposed`);
				state.listeners.add(listener);
				safely("subscriber", () => listener(active === state));
				return () => state.listeners.delete(listener);
			},
			dispose() {
				if (state.disposed) return;
				state.disposed = true;
				transition(() => {
					if (active === state) closeActive(true);
					state.listeners.clear();
					registrations.delete(panel.id);
				});
			},
		};
	};

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		transition(() => {
			closeActive(false);
			returnFocus = undefined;
			for (const state of registrations.values()) {
				state.disposed = true;
				state.listeners.clear();
			}
			registrations.clear();
			options.document.removeEventListener("keydown", onKeyDown);
		});
	};

	return { register, dispose } satisfies PanelCoordinator<Content>;
}
