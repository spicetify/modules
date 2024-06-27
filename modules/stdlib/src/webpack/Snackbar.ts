/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { } from "../../mix.ts";
import { exportedFunctions } from "./index.ts";
import { findBy } from "/hooks/util.ts";

import type {
	EnqueueSnackbar as EnqueueSnackbarT,
	OptionsObject as OptionsObjectT,
	useSnackbar as useSnackbarT,
} from "npm:notistack";

export type useSnackbar = typeof useSnackbarT;
export type OptionsObject = OptionsObjectT;
export type EnqueueSnackbar = EnqueueSnackbarT;

export let useSnackbar: useSnackbar;

type FN_enqueueCustomSnackbar_OPTS =
	| (Omit<OptionsObject, "key"> & { keyPrefix: string; })
	| (OptionsObject & { identifier: string; });
export let enqueueCustomSnackbar: (
	element: React.ReactElement,
	opts: FN_enqueueCustomSnackbar_OPTS,
) => ReturnType<EnqueueSnackbar>;

CHUNKS.xpui.promise.then(() => {
	useSnackbar = findBy(
		/^function\(\)\{return\(0,[a-zA-Z_\$][\w\$]*\.useContext\)\([a-zA-Z_\$][\w\$]*\)\}$/,
	)(exportedFunctions);

	enqueueCustomSnackbar = findBy("enqueueCustomSnackbar", "headless")(exportedFunctions) as any;
});
