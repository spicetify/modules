/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../src/expose/React.ts";
import { Locale } from "../src/webpack/misc.ts";

import RootRegistry from "../src/registers/root.ts";
const [RootChildrenRegistry] = RootRegistry;
import { createIconComponent } from "../src/createIconComponent.tsx";

let ref: React.ReactElement | undefined = undefined;

export function display({ title, content, isLarge }: { title: string; content: React.ReactElement; isLarge: boolean }) {
	hide();

	RootChildrenRegistry.add(
		(ref = (
			<PopupModal contentLabel={title} children={content} isEmbedWidgetGeneratorOrTrackCreditsModal={isLarge} />
		)),
	);
}

export function hide() {
	if (ref) {
		RootChildrenRegistry.delete(ref);
		ref = undefined;
	}
}

interface PopupModalProps {
	contentLabel: string;
	children: React.ReactNode;
	isEmbedWidgetGeneratorOrTrackCreditsModal: boolean;
}

// Self-contained modal shell: client modal components (GenericModal, UI.*)
// require the client tree's contexts, which anchors don't have. The shell
// owns the backdrop and dismissal; the MAP-classed chrome keeps native
// styling.
const ModalShell = (props: { contentLabel: string; children: React.ReactNode }) => {
	React.useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			hide();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div
			role="dialog"
			aria-label={props.contentLabel}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 100,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0, 0, 0, 0.7)",
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget) hide();
			}}
		>
			<div
				style={{
					background: "var(--spice-card, var(--background-elevated-base, #282828))",
					color: "var(--spice-text, var(--text-base, #fff))",
					borderRadius: "8px",
					maxHeight: "80vh",
					maxWidth: "90vw",
					overflow: "auto",
				}}
			>
				{props.children}
			</div>
		</div>
	);
};

const closeIcon =
	"<path d='M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06Z'/>";

const PopupModal = (props: PopupModalProps) => {
	if (props.isEmbedWidgetGeneratorOrTrackCreditsModal) {
		return (
			<ModalShell contentLabel={props.contentLabel}>
				<div className={MAP.modal.widget_generator.container} style={{ overflow: "scroll", width: "60vw" }}>
					<div className={MAP.modal.widget_generator.header.container}>
						<h1 className="encore-text encore-text-title-small">{props.contentLabel}</h1>
						<button className={MAP.modal.widget_generator.header.close} onClick={hide}>
							{createIconComponent({
								icon: closeIcon,
								"aria-label": Locale.get("close"),
							})}
						</button>
					</div>
					<div className={MAP.modal.widget_generator.content.container}>{props.children}</div>
				</div>
			</ModalShell>
		);
	}

	return (
		<ModalShell contentLabel={props.contentLabel}>
			<div className={MAP.modal.track_credits.container}>
				<div className={MAP.modal.track_credits.header.container}>
					<h1 className="encore-text encore-text-title-medium">{props.contentLabel}</h1>
					<button
						className={MAP.modal.track_credits.header.close}
						aria-label={Locale.get("close")}
						onClick={hide}
					>
						{createIconComponent({
							icon: closeIcon,
							"aria-label": Locale.get("close"),
							iconSize: 18,
						})}
					</button>
				</div>
				<div className={MAP.modal.track_credits.content.container}>{props.children}</div>
			</div>
		</ModalShell>
	);
};
