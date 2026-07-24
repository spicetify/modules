/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exportedFunctions } from "./index.ts";

type FlippedT = any;
type FlipperT = any;

await CHUNKS.xpui.promise;

export const Flipper: FlipperT = exportedFunctions.find((m) => m.prototype?.getSnapshotBeforeUpdate)!;
export const Flipped: FlippedT = exportedFunctions.find((m) => (m as any).displayName === "Flipped")!;
