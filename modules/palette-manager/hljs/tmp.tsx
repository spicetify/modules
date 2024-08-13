// @deno-types="npm:highlight.js@11.10.0"
import hljs from "https://esm.sh/highlight.js@11.10.0/lib/core";
const HighlightJS = hljs as typeof import("npm:highlight.js").default;

import css from "./css.ts";

// <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css">
const hl = HighlightJS.newInstance();
hl.registerLanguage("css", css);

///

type Emitter = import("npm:highlight.js").Emitter;
type HLJSOptions = import("npm:highlight.js").HLJSOptions;
type HighlightResult = import("npm:highlight.js").HighlightResult;
type LanguageFn = import("npm:highlight.js").LanguageFn;
type RootData = import("npm:@types/hast").RootData;
type Root = import("npm:@types/hast").Root;
type Element = import("npm:@types/hast").Element;
type ElementContent = import("npm:@types/hast").ElementContent;

class HastEmitter implements Emitter {
	root = {
		type: "root",
		children: [],
		data: { language: undefined, relevance: 0 },
	} as Root;
	stack = [this.root] as [Root, ...Array<Element>];
	constructor(private options: Readonly<HLJSOptions>) {}

	addText(value: string) {
		if (value === "") return;

		const current = this.stack[this.stack.length - 1];
		const tail = current.children[current.children.length - 1];

		if (tail && tail.type === "text" && false) {
			tail.value += value;
		} else {
			current.children.push({ type: "text", value });
		}
	}

	startScope(rawName: unknown) {
		this.openNode(String(rawName));
	}

	endScope() {
		this.closeNode();
	}

	__addSublanguage(other: HastEmitter, name: string) {
		const current = this.stack[this.stack.length - 1];
		const results: Array<ElementContent> = other.root.children;

		if (name) {
			current.children.push({
				type: "element",
				tagName: "span",
				properties: { className: [name] },
				children: results,
			});
		} else {
			current.children.push(...results);
		}
	}

	openNode(name: string) {
		// First “class” gets the prefix. Rest gets a repeated underscore suffix.
		// See: <https://github.com/highlightjs/highlight.js/commit/51806aa>
		// See: <https://github.com/wooorm/lowlight/issues/43>
		const className = name.split(".").map((d, i) =>
			i ? d + "_".repeat(i) : this.options.classPrefix + d
		);
		const current = this.stack[this.stack.length - 1];
		const child: Element = {
			type: "element",
			tagName: "span",
			properties: { className },
			children: [],
		};

		current.children.push(child);
		this.stack.push(child);
	}

	closeNode() {
		this.stack.pop();
	}

	finalize() {}

	toHTML() {
		return "";
	}
}

interface Options {
	prefix?: string;
}

function highlight(value: string) {
	// See: <https://github.com/highlightjs/highlight.js/issues/3621#issuecomment-1528841888>
	hl.configure({ __emitter: HastEmitter, classPrefix: "hljs-" });

	const result = hl.highlight(value, {
		ignoreIllegals: true,
		language: "css",
	}) as
		& HighlightResult
		& { _emitter: HastEmitter };

	if (result.errorRaised) {
		throw new Error("Could not highlight with `Highlight.js`", {
			cause: result.errorRaised,
		});
	}

	const root = result._emitter.root;
	const language = root.data!.language as string;
	const relevance = root.data!.relevance as number;
	return { root, language, relevance };
}

import { React } from "/modules/stdlib/src/expose/React.ts";

interface CCProps {
	element: ElementContent;
	i: number;
	depth: number;
}
export const CSSCodeElement: React.FC<CCProps> = (props) => {
	if ("tagName" in props.element) {
		return React.createElement(
			props.element.tagName,
			Object.assign(
				{ key: "lo-" + props.depth + "-" + props.i },
				props.element.properties,
			),
			props.element.children?.map((element, i) =>
				CSSCodeElement({ element, i, depth: props.depth + 1 })
			),
		);
	}

	return props.element.value;
};

interface CProps {
	inline?: boolean;
	className?: string;
	value: string;
}
export const CSSCodeBlock = React.forwardRef<HTMLElement, CProps>(
	(props, ref) => {
		const { root, language } = highlight(props.value);

		const value = root.children.map((element, i) =>
			CSSCodeElement({ element, i, depth: 0 })
		);

		const codeProps: React.DetailedHTMLProps<
			React.HTMLAttributes<HTMLElement>,
			HTMLElement
		> = {
			className: "hljs",
			style: {},
			ref: null,
		};

		const preProps: React.DetailedHTMLProps<
			React.HTMLAttributes<HTMLElement>,
			HTMLElement
		> = {
			ref,
			className: props.className,
		};

		if (language) {
			codeProps.className += " " + language;
		}

		if (props.inline) {
			codeProps.style = { display: "inline" };
			codeProps.className = props.className;
			codeProps.ref = ref;
		}

		const code = <code {...codeProps}>{value}</code>;
		return props.inline ? code : <pre {...preProps}>{code}</pre>;
	},
);
