/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { postWebpackRequireHooks } from "./wpunpk.mix.ts";

import { BehaviorSubject, Subject } from "https://esm.sh/rxjs";

function createGlobalThisShadow() {
	const globalThisShadow = {} as typeof globalThis;

	Object.setPrototypeOf(globalThisShadow, globalThis);

	Object.defineProperty(globalThisShadow, "self", { value: globalThisShadow });
	Object.defineProperty(globalThisShadow, "globalThis", { value: globalThisShadow });
	Object.defineProperty(globalThisShadow, "window", { value: globalThisShadow });

	return globalThisShadow;
}

export const ControlMessageListenerSubject = new Subject<{ uri: string; method: string; body: string }>();
export const UpdateTitlebarSubject = new BehaviorSubject<number>(-1);

postWebpackRequireHooks.push(($) => {
	const globalThisShadow = $.g = createGlobalThisShadow();

	const $sendCosmosRequest = globalThis.sendCosmosRequest;
	Object.defineProperty(globalThisShadow, "sendCosmosRequest", {
		value: function ($: any) {
			const request = JSON.parse($.request);

			ControlMessageListenerSubject.next(request);

			return $sendCosmosRequest($);
		},
	});
});

const controlMessageListener = (request: { uri: string; method: string; body: string }) => {
	const { uri, method } = request;

	if (uri === "sp://messages/v1/container/control" && method === "POST") {
		const body = JSON.parse(request.body);
		const { type, height } = body;

		if (type === "update_titlebar") {
			UpdateTitlebarSubject.next(height);
		}
	}
};

ControlMessageListenerSubject.subscribe(controlMessageListener);
