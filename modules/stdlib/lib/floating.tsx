/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, ReactDOM } from "../src/expose/React.ts";
import { calculateFloatingPosition } from "./floating-position.ts";

const TOOLTIP_HIDE_DELAY_MS = 300;
const FOCUSABLE_SELECTOR =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type FloatingRole = "dialog" | "menu";
type TriggerProps = React.AriaAttributes & {
	disabled?: boolean;
	onClick?: React.MouseEventHandler<HTMLElement>;
};

function useFloatingPlacement(
	open: boolean,
	anchorRef: React.RefObject<HTMLElement | null>,
	surfaceRef: React.RefObject<HTMLElement | null>,
	align: "center" | "start",
	gap: number,
): void {
	React.useLayoutEffect(() => {
		if (!open) return;
		const anchor = anchorRef.current;
		const surface = surfaceRef.current;
		if (!anchor || !surface) return;

		const place = () => {
			if (!anchor.isConnected || !surface.isConnected) return;
			const anchorRect = anchor.getBoundingClientRect();
			const surfaceRect = surface.getBoundingClientRect();
			const position = calculateFloatingPosition(
				anchorRect,
				surfaceRect,
				{ width: window.innerWidth, height: window.innerHeight },
				{ align, gap },
			);
			surface.style.left = `${position.left}px`;
			surface.style.top = `${position.top}px`;
			surface.style.visibility = "visible";
			surface.dataset.placement = position.placement;
		};

		place();
		window.addEventListener("resize", place);
		document.addEventListener("scroll", place, true);
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
		observer?.observe(anchor);
		observer?.observe(surface);
		return () => {
			window.removeEventListener("resize", place);
			document.removeEventListener("scroll", place, true);
			observer?.disconnect();
		};
	}, [align, anchorRef, gap, open, surfaceRef]);
}

function focusTrigger(anchor: HTMLElement | null): void {
	anchor?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
}

function moveMenuFocus(event: React.KeyboardEvent<HTMLElement>): void {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')];
	if (!items.length) return;
	event.preventDefault();
	const currentIndex = items.indexOf(document.activeElement as HTMLElement);
	const nextIndex =
		event.key === "Home"
			? 0
			: event.key === "End"
				? items.length - 1
				: (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
	items[nextIndex]?.focus();
}

function usePopoverDismissal(
	open: boolean,
	close: () => void,
	anchorRef: React.RefObject<HTMLElement | null>,
	surfaceRef: React.RefObject<HTMLElement | null>,
): void {
	React.useEffect(() => {
		if (!open) return;
		const onDocumentMouseDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!anchorRef.current?.contains(target) && !surfaceRef.current?.contains(target)) close();
		};
		const onDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			close();
			requestAnimationFrame(() => focusTrigger(anchorRef.current));
		};
		const onDocumentFocus = (event: FocusEvent) => {
			const target = event.target as Node;
			if (!anchorRef.current?.contains(target) && !surfaceRef.current?.contains(target)) close();
		};

		document.addEventListener("mousedown", onDocumentMouseDown, true);
		document.addEventListener("keydown", onDocumentKeyDown, true);
		document.addEventListener("focusin", onDocumentFocus, true);
		return () => {
			document.removeEventListener("mousedown", onDocumentMouseDown, true);
			document.removeEventListener("keydown", onDocumentKeyDown, true);
			document.removeEventListener("focusin", onDocumentFocus, true);
		};
	}, [anchorRef, close, open, surfaceRef]);
}

export const Tooltip: React.FC<{
	label: React.ReactNode;
	children: React.ReactElement<TriggerProps>;
}> = (props) => {
	const id = React.useId();
	const anchorRef = React.useRef<HTMLSpanElement>(null);
	const tooltipRef = React.useRef<HTMLDivElement>(null);
	const hideTimer = React.useRef<number>();
	const [visible, setVisible] = React.useState(false);
	const cancelHide = React.useCallback(() => window.clearTimeout(hideTimer.current), []);
	const show = React.useCallback(() => {
		cancelHide();
		setVisible(true);
	}, [cancelHide]);
	const dismiss = React.useCallback(() => {
		cancelHide();
		setVisible(false);
	}, [cancelHide]);
	const scheduleHide = React.useCallback(() => {
		cancelHide();
		hideTimer.current = window.setTimeout(() => setVisible(false), TOOLTIP_HIDE_DELAY_MS);
	}, [cancelHide]);
	useFloatingPlacement(visible, anchorRef, tooltipRef, "center", 8);

	React.useEffect(() => () => cancelHide(), [cancelHide]);
	React.useEffect(() => {
		if (!visible) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			cancelHide();
			setVisible(false);
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [cancelHide, visible]);

	const existingDescription = props.children.props["aria-describedby"];
	const describedBy = [existingDescription, id].filter(Boolean).join(" ");
	const child = React.cloneElement(props.children, { "aria-describedby": describedBy });
	const disabled = props.children.props.disabled === true;

	return (
		<span
			ref={anchorRef}
			className="spicetify-floating-anchor"
			tabIndex={disabled ? 0 : undefined}
			aria-describedby={disabled ? id : undefined}
			onClickCapture={dismiss}
			onPointerEnter={show}
			onPointerLeave={scheduleHide}
			onFocusCapture={show}
			onBlurCapture={scheduleHide}
		>
			{child}
			{visible
				? ReactDOM.createPortal(
						<div
							ref={tooltipRef}
							id={id}
							role="tooltip"
							className="spicetify-tooltip"
							style={{ visibility: "hidden" }}
							onPointerEnter={cancelHide}
							onPointerLeave={scheduleHide}
						>
							{props.label}
						</div>,
						document.body,
					)
				: null}
		</span>
	);
};

export const Popover: React.FC<{
	ariaLabel: string;
	children: React.ReactElement<TriggerProps>;
	content: React.ReactNode | ((close: () => void) => React.ReactNode);
	role?: FloatingRole;
	align?: "center" | "start";
	className?: string;
	tooltip?: React.ReactNode;
	onClose?: () => void;
}> = (props) => {
	const id = React.useId();
	const anchorRef = React.useRef<HTMLSpanElement>(null);
	const surfaceRef = React.useRef<HTMLDivElement>(null);
	const openRef = React.useRef(false);
	const [open, setOpen] = React.useState(false);
	const close = React.useCallback(() => {
		if (!openRef.current) return;
		openRef.current = false;
		setOpen(false);
		props.onClose?.();
	}, [props.onClose]);
	const toggle = () => {
		if (openRef.current) {
			close();
			return;
		}
		openRef.current = true;
		setOpen(true);
	};
	const role = props.role ?? "dialog";
	useFloatingPlacement(open, anchorRef, surfaceRef, props.align ?? "start", 8);
	usePopoverDismissal(open, close, anchorRef, surfaceRef);
	React.useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() => {
			const surface = surfaceRef.current;
			(surface?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? surface)?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [open]);
	React.useEffect(
		() => () => {
			openRef.current = false;
		},
		[],
	);

	const originalClick = props.children.props.onClick;
	const trigger = React.cloneElement(props.children, {
		"aria-haspopup": role,
		"aria-expanded": open,
		"aria-controls": open ? id : undefined,
		onClick: (event: React.MouseEvent<HTMLElement>) => {
			originalClick?.(event);
			if (!event.defaultPrevented) toggle();
		},
	});
	const describedTrigger = props.tooltip ? <Tooltip label={props.tooltip}>{trigger}</Tooltip> : trigger;
	const surfaceClass = props.className
		? `spicetify-popover spicetify-popover--owned ${props.className}`
		: "spicetify-popover spicetify-popover--owned";

	return (
		<span ref={anchorRef} className="spicetify-floating-anchor">
			{describedTrigger}
			{open
				? ReactDOM.createPortal(
						<div
							ref={surfaceRef}
							id={id}
							role={role}
							aria-label={props.ariaLabel}
							className={surfaceClass}
							tabIndex={-1}
							style={{ visibility: "hidden" }}
							onKeyDown={role === "menu" ? moveMenuFocus : undefined}
						>
							{typeof props.content === "function" ? props.content(close) : props.content}
						</div>,
						document.body,
					)
				: null}
		</span>
	);
};

export const PopoverMenu: React.FC<{ children: React.ReactNode }> = (props) => (
	<div className="spicetify-popover-menu">{props.children}</div>
);

export const PopoverMenuItem: React.FC<{
	selected?: boolean;
	disabled?: boolean;
	onSelect: () => void;
	children: React.ReactNode;
}> = (props) => (
	<button
		type="button"
		role={props.selected === undefined ? "menuitem" : "menuitemradio"}
		aria-checked={props.selected}
		className="spicetify-popover-menu-item"
		disabled={props.disabled}
		onClick={props.onSelect}
	>
		<span>{props.children}</span>
	</button>
);
