/*
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function relocateElement(element: Element, target: Element): () => void {
	const originalParent = element.parentNode;
	const originalNextSibling = element.nextSibling;
	target.append(element);

	return () => {
		if (originalParent?.isConnected) {
			originalParent.insertBefore(
				element,
				originalNextSibling?.parentNode === originalParent ? originalNextSibling : null,
			);
		} else {
			element.remove();
		}
	};
}
