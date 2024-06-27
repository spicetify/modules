/*
 * Copyright (C) 2024 Delusoire
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformer } from "../../mix.ts";

export type GraphQLOp = "query" | "mutation";
export type GraphQLDef<N extends string, O extends GraphQLOp> = {
	name: N;
	operation: O;
	sha256Hash: string;
	value: null;
};
export type GraphQLDefs = { [O in GraphQLOp]: { [N in string]: GraphQLDef<N, O> } };

export const GraphQLDefs = {
	query: {},
	mutation: {},
} as GraphQLDefs;

transformer(
	emit => str => {
		const matches = str.matchAll(
			/(=new [a-zA-Z_\$][\w\$]*\.[a-zA-Z_\$][\w\$]*\("(?<name>\w+)","(?<operation>query|mutation)","(?<sha256Hash>[\w\d]{64})",null\))/g,
		);
		for (const match of matches) {
			const { name, operation, sha256Hash } = match.groups!;
			// @ts-ignore
			GraphQLDefs[operation][name] = { name, operation, sha256Hash, value: null };
		}
		emit();
		return str;
	},
	{
		glob: /.+\.js$/,
	},
);
