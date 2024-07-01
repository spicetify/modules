/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {} from "../../mix.ts";
import { exportedFunctions } from "./index.ts";
import { findBy } from "/hooks/util.ts";

import type {
	EnqueueSnackbar as EnqueueSnackbarT,
	OptionsObject as OptionsObjectT,
	useSnackbar as useSnackbarT,
} from "npm:notistack";

await CHUNKS.xpui.Promise;

export const useSnackbar: typeof useSnackbarT = findBy(
	/^function\(\)\{return\(0,[a-zA-Z_\$][\w\$]*\.useContext\)\([a-zA-Z_\$][\w\$]*\)\}$/,
)(exportedFunctions);

type FN_enqueueCustomSnackbar_OPTS =
	| (Omit<OptionsObjectT, "key"> & { keyPrefix: string })
	| (OptionsObjectT & { identifier: string });
export const enqueueCustomSnackbar: (
	element: React.ReactElement,
	opts: FN_enqueueCustomSnackbar_OPTS,
) => ReturnType<EnqueueSnackbarT> = findBy("enqueueCustomSnackbar", "headless")(exportedFunctions);
