/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class Registry<E> extends Set<E> {
	_E!: E;

	public all(): Array<E> {
		return Array.from(this);
	}
}
