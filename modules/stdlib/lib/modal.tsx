/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../src/expose/React.ts";
import { UI } from "../src/webpack/ComponentLibrary.ts";
import { Locale } from "../src/webpack/misc.ts";
import { GenericModal } from "../src/webpack/ReactComponents.ts";

import RootRegistry from "../src/registers/root.ts";
const [RootChildrenRegistry, RootProvidersRegistry] = RootRegistry;
import { createIconComponent } from "./createIconComponent.tsx";

let ref: React.ReactElement | undefined = undefined;

export function display({ title, content, isLarge }: {
	title: string;
	content: React.ReactElement;
	isLarge: boolean;
}) {
	hide();

	RootChildrenRegistry.add(
		ref = (
			<PopupModal
				contentLabel={title}
				children={content}
				isEmbedWidgetGeneratorOrTrackCreditsModal={isLarge}
			/>
		),
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
const PopupModal = (props: PopupModalProps) => {
	const isOpen = true;

	if (props.isEmbedWidgetGeneratorOrTrackCreditsModal) {
		return (
			<GenericModal isOpen={isOpen} contentLabel={props.contentLabel}>
				<div className={MAP.modal.widget_generator.container} style={{ overflow: "scroll", width: "60vw" }}>
					<div className={MAP.modal.widget_generator.header.container}>
						<UI.Text as="h1" variant="titleSmall">
							{props.contentLabel}
						</UI.Text>
						<button className={MAP.modal.widget_generator.header.close} onClick={hide}>
							{createIconComponent({
								icon:
									"<path d='M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06Z'/>",
								"aria-label": Locale.get("close"),
							})}
						</button>
					</div>
					<div className={MAP.modal.widget_generator.content.container}>{props.children}</div>
				</div>
			</GenericModal>
		);
	}

	return (
		<GenericModal isOpen={isOpen} contentLabel={props.contentLabel}>
			<div className={MAP.modal.track_credits.container}>
				<div className={MAP.modal.track_credits.header.container}>
					<UI.Text as="h1" variant="titleMedium">
						{props.contentLabel}
					</UI.Text>
					<button
						className={MAP.modal.track_credits.header.close}
						aria-label={Locale.get("close")}
						onClick={hide}
					>
						{createIconComponent({
							icon:
								"<path d='M2.47 2.47a.75.75 0 0 1 1.06 0L8 6.94l4.47-4.47a.75.75 0 1 1 1.06 1.06L9.06 8l4.47 4.47a.75.75 0 1 1-1.06 1.06L8 9.06l-4.47 4.47a.75.75 0 0 1-1.06-1.06L6.94 8 2.47 3.53a.75.75 0 0 1 0-1.06Z'/>",
							"aria-label": Locale.get("close"),
							iconSize: 18,
						})}
					</button>
				</div>
				<div className={MAP.modal.track_credits.content.container}>{props.children}</div>
			</div>
		</GenericModal>
	);
};
