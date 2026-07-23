/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// wpunpk.mix: webpack require access for the v3 modular runtime.
// The modular loader captures __webpack_require__ itself after the client is
// up (pre-boot chunk registration is fatal to the snapshot runtime). This
// module forwards to it lazily and keeps the hooks-era contract intact.

class Subject<T = unknown> {
	private observers = new Set<(value: T) => void>();
	subscribe(fn: (value: T) => void) {
		this.observers.add(fn);
		return { unsubscribe: () => this.observers.delete(fn) };
	}
	next(value: T) {
		for (const fn of this.observers) fn(value);
	}
}

class BehaviorSubject<T> extends Subject<T> {
	constructor(private current: T) {
		super();
	}
	override subscribe(fn: (value: T) => void) {
		const sub = super.subscribe(fn);
		fn(this.current);
		return sub;
	}
	override next(value: T) {
		this.current = value;
		super.next(value);
	}
	getValue() {
		return this.current;
	}
}

export { Subject, BehaviorSubject };

export const chunkLoadedSubjectPre = new Subject<unknown>();
export const chunkLoadedSubjectPost = new Subject<unknown>();
export const moduleLoadedSubject = new Subject<unknown>();

const pendingHooks: Array<(wpr: unknown) => void> = [];
export const postWebpackRequireHooks = {
	push(hook: (wpr: unknown) => void) {
		if (typeof globalThis.__webpack_require__ === "function") {
			try {
				hook(globalThis.__webpack_require__);
			} catch (e) {
				console.error(e);
			}
			return 0;
		}
		pendingHooks.push(hook);
		ensureDrainTimer();
		return pendingHooks.length;
	},
};

export type WebpackRequire = {
	(id: string | number): unknown;
	m: Record<string, unknown>;
};

export const webpackRequire: WebpackRequire = new Proxy(function () {}, {
	get: (_, k) => globalThis.__webpack_require__?.[k as never] ?? (k === "m" ? {} : undefined),
	apply: (_, __, args) => (globalThis.__webpack_require__ as never as WebpackRequire)(...args),
}) as never;

const drain = () => {
	if (typeof globalThis.__webpack_require__ !== "function") return false;
	for (const hook of pendingHooks.splice(0)) {
		try {
			hook(globalThis.__webpack_require__);
		} catch (e) {
			console.error(e);
		}
	}
	return true;
};
// Hooks can be pushed at mixin time (pre-boot) or load time (post-boot),
// and capture can land arbitrarily late — each pending push (re)arms a
// bounded poll instead of relying on one module-eval-time window.
let drainTimer: ReturnType<typeof setInterval> | undefined;
const ensureDrainTimer = () => {
	if (drainTimer !== undefined) return;
	let tries = 0;
	drainTimer = setInterval(() => {
		if (drain() || ++tries > 400) {
			clearInterval(drainTimer);
			drainTimer = undefined;
		}
	}, 50);
};

declare global {
	var __webpack_require__: WebpackRequire | undefined;
}
