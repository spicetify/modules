/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @deno-types="npm:@types/lodash"
import ld from "https://esm.sh/lodash";
export const _ = ld;

// @deno-types="npm:@types/lodash/fp"
import ld_fp from "https://esm.sh/lodash/fp";
export const fp = ld_fp;

export { default as startCase } from "https://esm.sh/lodash/startCase";
export { default as kebabCase } from "https://esm.sh/lodash/kebabCase";
export { default as capitalize } from "https://esm.sh/lodash/fp/capitalize";
