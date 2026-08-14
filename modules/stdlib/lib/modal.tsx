/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "../src/expose/React.ts";
import RootRegistry from "../src/registers/root.ts";
import { Dialog } from "./primitives.tsx";

const [RootChildrenRegistry] = RootRegistry;

export interface ModalOptions {
	title: string;
	content: React.ReactNode;
	isLarge?: boolean;
}

let mountedModal: React.ReactElement | undefined;

export function display({ title, content, isLarge = false }: ModalOptions): void {
	hide();
	mountedModal = (
		<Dialog title={title} size={isLarge ? "large" : "normal"} onClose={hide}>
			{content}
		</Dialog>
	);
	RootChildrenRegistry.add(mountedModal);
}

export function hide(): void {
	if (!mountedModal) return;
	RootChildrenRegistry.delete(mountedModal);
	mountedModal = undefined;
}
