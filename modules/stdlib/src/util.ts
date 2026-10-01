/*
 * Copyright (C) 2024 Delusoire
 * Copyright (C) 2026 Afonso Jorge Ramos
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Inlined from the hooks-era /hooks/util.ts and /hooks/std/text.ts (a
// data-URL bundle of jsr:@std/text), which were stdlib's last imports
// from the retired hooks runtime. findBy carries the CLI compat pack's
// hostile-exports fix, which the hooks repo never received; inlining
// ends that typecheck-vs-runtime divergence.

type Predicate<A> = (value: A) => boolean;

// Some client exports are functions whose own toString is not callable;
// they can never match a needle, so they stringify to "".
const stringify = (x: any): string => {
	if (x == null) return "";
	try {
		return String(x);
	} catch {
		try {
			return Function.prototype.toString.call(x);
		} catch {
			return "";
		}
	}
};

const sources = new WeakMap<object, string>();

// sourceOf is the source text needles match against, computed once per
// function or object for the whole session.
export const sourceOf = (x: unknown): string => {
	if ((typeof x !== "object" && typeof x !== "function") || x === null) return stringify(x);
	let source = sources.get(x);
	if (source === undefined) {
		source = stringify(x);
		sources.set(x, source);
	}
	return source;
};

export function findBy(...tests: Array<string | RegExp | Predicate<any>>) {
	const testFns = tests.map((test): Predicate<any> => {
		switch (typeof test) {
			case "string":
				return (x) => sourceOf(x).includes(test);
			case "function":
				return (x) => test(x);
			default: // assume regex
				return (x) => test.test(sourceOf(x));
		}
	});
	const testFn = (x: any) => testFns.every((t) => t(x));
	return <A>(xs: A[]) => xs.find(testFn)!;
}

export const matchLast = (str: string, pattern: RegExp) => {
	const matches = str.matchAll(pattern);
	return Array.from(matches).at(-1)!;
};

// toPascalCase must stay byte-identical to @std/text@1.0.4: its outputs
// become webpack-needle registry keys (URI types, component names).
// Alternatives, in @std/text's order: capitalized word, acronym,
// lowercase word, any letters, digits.
const WORD_OR_NUMBER = /\p{Lu}\p{Ll}+|\p{Lu}+(?=(\p{Lu}\p{Ll})|\P{L}|\b)|(\p{Ll}+)|\p{L}+|\p{N}+/gu;

const splitToWords = (input: string) => input.match(WORD_OR_NUMBER) ?? [];

const capitalizeWord = (word: string) =>
	word ? word[0].toLocaleUpperCase() + word.slice(1).toLocaleLowerCase() : word;

export function toPascalCase(input: string): string {
	return splitToWords(input.trim()).map(capitalizeWord).join("");
}
