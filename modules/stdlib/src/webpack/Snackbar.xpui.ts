/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exportedFunctions } from "./index.ts";
import { findBy } from "/hooks/util.ts";

// notistack ships inside the client bundle; these aliases stand in
// for its types, which cannot be resolved from the npm: URL.
type EnqueueSnackbarT = (...args: any[]) => any;
type OptionsObjectT = Record<string, any>;
type useSnackbarT = () => any;

await CHUNKS.xpui.promise;

export const useSnackbar: useSnackbarT = findBy(
	/^function\(\)\{return\(0,[a-zA-Z_\$][\w\$]*\.useContext\)\([a-zA-Z_\$][\w\$]*\)\}$/,
)(exportedFunctions);

type FN_enqueueCustomSnackbar_OPTS =
	| (Omit<OptionsObjectT, "key"> & { keyPrefix: string })
	| (OptionsObjectT & { identifier: string });
export const enqueueCustomSnackbar: (
	element: React.ReactElement,
	opts: FN_enqueueCustomSnackbar_OPTS,
) => ReturnType<EnqueueSnackbarT> = findBy("enqueueCustomSnackbar", "headless")(exportedFunctions);
