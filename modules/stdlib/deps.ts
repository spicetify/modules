/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export { default as clamp } from "https://esm.sh/lodash@4.17.21/clamp";
export { default as capitalize } from "https://esm.sh/lodash@4.17.21/fp/capitalize";
export { default as shuffle } from "https://esm.sh/lodash@4.17.21/fp/shuffle";
export { default as get } from "https://esm.sh/lodash@4.17.21/get";
export { default as range } from "https://esm.sh/lodash@4.17.21/range";
export { default as sortedLastIndex } from "https://esm.sh/lodash@4.17.21/sortedLastIndex";
export { default as sortedLastIndexBy } from "https://esm.sh/lodash@4.17.21/sortedLastIndexBy";
export { default as startCase } from "https://esm.sh/lodash@4.17.21/startCase";
export { default as uniq } from "https://esm.sh/lodash@4.17.21/uniq";

import { default as mean } from "https://esm.sh/lodash@4.17.21/fp/mean";
export const fp = { mean };

export {
	BehaviorSubject,
	Subject,
	Subscription,
} from "https://esm.sh/rxjs@7.8.1?exports=BehaviorSubject,Subscription,Subject";
