/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export { default as startCase } from "https://esm.sh/lodash/startCase";
export { default as capitalize } from "https://esm.sh/lodash/fp/capitalize";
export { default as shuffle } from "https://esm.sh/lodash/fp/shuffle";
export { default as clamp } from "https://esm.sh/lodash/clamp";
export { default as sortedLastIndexBy } from "https://esm.sh/lodash/sortedLastIndexBy";
export { default as sortedLastIndex } from "https://esm.sh/lodash/sortedLastIndex";
export { default as range } from "https://esm.sh/lodash/range";
export { default as uniq } from "https://esm.sh/lodash/uniq";

// export { clamp, capitalize, shuffle, range, sortedLastIndex, sortedLastIndexBy, startCase, uniq } from "https://esm.sh/lodash?exports=clamp,capitalize,shuffle,range,sortedLastIndex,sortedLastIndexBy,startCase,uniq";

import { default as mean } from "https://esm.sh/lodash/fp/mean";
export const fp = { mean };

// import _fp from "https://esm.sh/lodash/fp?exports=mean";
// export const fp = _fp;
