/*
 * Copyright (C) 2026 veryboringhwl
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runtime type extractor for Spotify's Platform API. Walks the live object
// graph, probes getters and safe get*() methods (bounded invocations, awaits,
// and nodes), passes noop callbacks to listener-shaped methods so shapes can
// be observed without subscribing, and emits TypeScript declarations for
// everything reached. METHOD_TYPES carries hand-written signatures for
// methods that must never be auto-invoked. Runs inside the client; the
// scripts/platform-types.ts runner injects it over CDP and commits the
// output as platform.d.ts.

type TypeNode =
	| { kind: "primitive"; type: string }
	| { kind: "class"; name: string }
	| { kind: "reference"; id: string }
	| { kind: "promise"; of: TypeNode }
	| { kind: "union"; types: TypeNode[] };

interface PropertyDef {
	type: TypeNode;
	isOptional: boolean;
	isReadonly: boolean;
}

interface FunctionNode {
	kind: "function";
	id: string;
	nameHints: string[];
	props: Map<string, PropertyDef>;
	arity: number;
	isAsync: boolean;
	returnType: TypeNode | null;
}

type StoreNode =
	| { kind: "array"; id: string; nameHints: string[]; elementType?: TypeNode }
	| {
			kind: "map";
			id: string;
			nameHints: string[];
			keyType?: TypeNode;
			valueType?: TypeNode;
	  }
	| { kind: "set"; id: string; nameHints: string[]; valueType?: TypeNode }
	| {
			kind: "object";
			id: string;
			nameHints: string[];
			props: Map<string, PropertyDef>;

			indexType?: TypeNode;
	  }
	| FunctionNode;

interface ExtractContext {
	owner: any;
	key: string;
}

const NOOP_CALLBACK = () => {};

const READ_PATTERN = /^get[A-Z0-9_]/;
const LISTENER_PATTERN = /^add(Event)?(Listeners?|Callbacks?|Handlers?)$|^subscribe$/i;
const IDENTIFIER_KEY = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

const MAX_INVOCATIONS = 3000;
const MAX_AWAITS = 1500;
const AWAIT_TIMEOUT_MS = 2000;
const MAX_NODES = 20000;

const IGNORED_ROOT_KEYS = new Set(["registry", "getRegistry"]);
const NOISE_SEGMENTS = new Set(["return", "registry", "map", "value", "key", "item", "items", "instance", "factory"]);
const IGNORED_PROPERTIES = new Set(["constructor", "caller", "callee", "arguments", "length", "name", "prototype"]);

const WEB_GLOBAL_IDENTITIES = [
	[globalThis, "Window"],
	...(typeof navigator !== "undefined" ? [[navigator, "Navigator"] as const] : []),
	...(typeof document !== "undefined" ? [[document, "Document"] as const] : []),
	...(typeof location !== "undefined" ? [[location, "Location"] as const] : []),
	...(typeof history !== "undefined" ? [[history, "History"] as const] : []),
	...(typeof performance !== "undefined" ? [[performance, "Performance"] as const] : []),
	...(typeof localStorage !== "undefined" ? [[localStorage, "Storage"] as const] : []),
	...(typeof sessionStorage !== "undefined" ? [[sessionStorage, "Storage"] as const] : []),
	...(typeof screen !== "undefined" ? [[screen, "Screen"] as const] : []),
	...(typeof crypto !== "undefined" ? [[crypto, "Crypto"] as const] : []),
	...(typeof caches !== "undefined" ? [[caches, "CacheStorage"] as const] : []),
	...(typeof customElements !== "undefined" ? [[customElements, "CustomElementRegistry"] as const] : []),
	...(typeof fetch !== "undefined" ? [[fetch, "typeof fetch"] as const] : []),
	...(typeof WebSocket !== "undefined" ? [[WebSocket, "typeof WebSocket"] as const] : []),
	...(typeof XMLHttpRequest !== "undefined" ? [[XMLHttpRequest, "typeof XMLHttpRequest"] as const] : []),
	...(typeof AbortController !== "undefined" ? [[AbortController, "typeof AbortController"] as const] : []),
	...(typeof RTCPeerConnection !== "undefined" ? [[RTCPeerConnection, "typeof RTCPeerConnection"] as const] : []),
	...(typeof setTimeout !== "undefined" ? [[setTimeout, "typeof setTimeout"] as const] : []),
	...(typeof requestAnimationFrame !== "undefined"
		? [[requestAnimationFrame, "typeof requestAnimationFrame"] as const]
		: []),
	...(typeof getComputedStyle !== "undefined" ? [[getComputedStyle, "typeof getComputedStyle"] as const] : []),
	...(typeof matchMedia !== "undefined" ? [[matchMedia, "typeof matchMedia"] as const] : []),
	...(typeof alert !== "undefined" ? [[alert, "typeof alert"] as const] : []),
	...(typeof confirm !== "undefined" ? [[confirm, "typeof confirm"] as const] : []),
	...(typeof prompt !== "undefined" ? [[prompt, "typeof prompt"] as const] : []),
	...(typeof open !== "undefined" ? [[open, "typeof open"] as const] : []),
	...(typeof atob !== "undefined" ? [[atob, "typeof atob"] as const] : []),
	...(typeof btoa !== "undefined" ? [[btoa, "typeof btoa"] as const] : []),
	...(typeof queueMicrotask !== "undefined" ? [[queueMicrotask, "typeof queueMicrotask"] as const] : []),
	...(typeof structuredClone !== "undefined" ? [[structuredClone, "typeof structuredClone"] as const] : []),
	...(typeof URL !== "undefined" ? [[URL, "typeof URL"] as const] : []),
	...(typeof Headers !== "undefined" ? [[Headers, "typeof Headers"] as const] : []),
	...(typeof Request !== "undefined" ? [[Request, "typeof Request"] as const] : []),
	...(typeof Response !== "undefined" ? [[Response, "typeof Response"] as const] : []),
	...(typeof Blob !== "undefined" ? [[Blob, "typeof Blob"] as const] : []),
	...(typeof FileReader !== "undefined" ? [[FileReader, "typeof FileReader"] as const] : []),
	...(typeof MutationObserver !== "undefined" ? [[MutationObserver, "typeof MutationObserver"] as const] : []),
	...(typeof ResizeObserver !== "undefined" ? [[ResizeObserver, "typeof ResizeObserver"] as const] : []),
	...(typeof IntersectionObserver !== "undefined"
		? [[IntersectionObserver, "typeof IntersectionObserver"] as const]
		: []),
	...(typeof PerformanceObserver !== "undefined"
		? [[PerformanceObserver, "typeof PerformanceObserver"] as const]
		: []),
	...(typeof MessageChannel !== "undefined" ? [[MessageChannel, "typeof MessageChannel"] as const] : []),
	...(typeof BroadcastChannel !== "undefined" ? [[BroadcastChannel, "typeof BroadcastChannel"] as const] : []),
	...(typeof AudioContext !== "undefined" ? [[AudioContext, "typeof AudioContext"] as const] : []),
	...(typeof Notification !== "undefined" ? [[Notification, "typeof Notification"] as const] : []),
	...(typeof Worker !== "undefined" ? [[Worker, "typeof Worker"] as const] : []),
	...(typeof SharedWorker !== "undefined" ? [[SharedWorker, "typeof SharedWorker"] as const] : []),
	...(typeof OffscreenCanvas !== "undefined" ? [[OffscreenCanvas, "typeof OffscreenCanvas"] as const] : []),
] as const;

const WEB_API_CONSTRUCTOR_NAMES = new Set([
	"EventTarget",
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"KeyboardEvent",
	"PointerEvent",
	"TouchEvent",
	"WheelEvent",
	"DragEvent",
	"ClipboardEvent",
	"MessageEvent",
	"ProgressEvent",
	"StorageEvent",
	"AnimationEvent",
	"TransitionEvent",
	"CompositionEvent",
	"PopStateEvent",
	"HashChangeEvent",
	"BeforeUnloadEvent",
	"ErrorEvent",
	"PageTransitionEvent",
	"MediaQueryListEvent",
	"PromiseRejectionEvent",
	"InputEvent",
	"FocusEvent",
	"SubmitEvent",
	"SecurityPolicyViolationEvent",
	"DOMRect",
	"DOMRectReadOnly",
	"DOMPoint",
	"DOMMatrix",
	"DOMTokenList",
	"DOMException",
	"MutationRecord",
	"ResizeObserverEntry",
	"IntersectionObserverEntry",
	"AbortSignal",
	"FormData",
	"File",
	"ImageData",
	"ImageBitmap",
	"URLSearchParams",
	"MessagePort",
	"IdleDeadline",
	"PermissionStatus",
	"SubtleCrypto",
	"CryptoKey",
	"MediaStream",
	"MediaStreamTrack",
	"MediaRecorder",
	"AudioContext",
	"AudioBuffer",
	"AnalyserNode",
	"BiquadFilterNode",
	"GainNode",
	"OscillatorNode",
	"WaveShaperNode",
	"PannerNode",
	"AudioWorkletNode",
	"AudioParam",
	"MediaElementAudioSourceNode",
	"MediaStreamAudioDestinationNode",
	"MediaStreamAudioSourceNode",
	"ConstantSourceNode",
	"ConvolverNode",
	"DelayNode",
	"DynamicsCompressorNode",
	"IIRFilterNode",
	"PeriodicWave",
	"StereoPannerNode",
	"ChannelMergerNode",
	"ChannelSplitterNode",
	"OfflineAudioContext",
	"WebGLRenderingContext",
	"WebGL2RenderingContext",
	"WebGLProgram",
	"WebGLShader",
	"WebGLBuffer",
	"WebGLTexture",
	"WebGLFramebuffer",
	"WebGLRenderbuffer",
	"WebGLUniformLocation",
	"CanvasRenderingContext2D",
	"CanvasGradient",
	"CanvasPattern",
	"Path2D",
	"TextMetrics",
	"OffscreenCanvas",
	"OffscreenCanvasRenderingContext2D",
	"VideoFrame",
	"ImageCapture",
	"CSSStyleDeclaration",
	"CSSRule",
	"CSSStyleRule",
	"CSSMediaRule",
	"CSSKeyframesRule",
	"CSSFontFaceRule",
	"CSSImportRule",
	"CSSSupportsRule",
	"CSSStyleSheet",
	"StyleSheetList",
	"MediaList",
	"StyleSheet",
	"CSSGroupingRule",
	"CSSNumericValue",
	"CSSUnitValue",
	"CSSKeywordValue",
	"CSSImageValue",
	"CSSVariableReferenceValue",
	"CSSUnparsedValue",
	"CSSStyleValue",
	"Text",
	"Comment",
	"DocumentFragment",
	"ShadowRoot",
	"DocumentType",
	"Attr",
	"DOMStringMap",
	"DataTransfer",
	"DataTransferItemList",
	"FileList",
	"Range",
	"Selection",
	"StaticRange",
	"Navigator",
	"Location",
	"History",
	"Screen",
	"PerformanceEntry",
	"PerformanceMark",
	"PerformanceMeasure",
	"PerformanceObserverEntryList",
	"ServiceWorkerRegistration",
	"Cache",
	"MediaQueryList",
	"VisualViewport",
	"InputDeviceCapabilities",
	"MediaDevices",
	"GeolocationPosition",
	"GeolocationCoordinates",
	"WakeLock",
	"WakeLockSentinel",
	"EyeDropper",
	"BarcodeDetector",
	"FaceDetector",
	"TextDetector",
	"Clipboard",
	"ClipboardItem",
	"ElementInternals",
	"HTMLSlotElement",
	"CustomElementRegistry",
	"Animation",
	"CSSAnimation",
	"CSSTransition",
	"DOMRectList",
	"NodeList",
	"HTMLCollection",
	"XPathResult",
	"TreeWalker",
	"NodeIterator",
	"NamedNodeMap",
	"ValidityState",
	"DOMParser",
	"XMLSerializer",
	"AudioWorklet",
	"Worklet",
	"AudioScheduledSourceNode",
	"AudioNode",
	"EventSource",
	"WebSocket",
	"RTCPeerConnection",
	"RTCDataChannel",
	"RTCDtlsTransport",
	"RTCIceTransport",
	"RTCSctpTransport",
	"MediaKeySession",
	"MediaKeySystemAccess",
]);

type InvocationResult = { ok: true; value: any } | { ok: false };

export interface MethodType {
	on: string;

	args: readonly string[];

	returns?: string;
}

export const METHOD_TYPES: readonly MethodType[] = [
	{
		on: "Platform.getRemoteConfigDebugAPI().setOverride",
		args: ["config: { source: string; type: string; name: string }", "value: string | number | boolean"],
		returns: "void",
	},
	{
		on: "Platform.getPlaylistAPI().getMetadata",
		args: ["uri: string", "options?: unknown"],
		returns: "Promise<unknown>",
	},
	{
		on: "Platform.getPlaylistAPI().updateDetails",
		args: ["uri: string", "details: object"],
		returns: "Promise<unknown>",
	},
	{
		on: "Platform.getProductStateAPI().productStateApi.putValues",
		args: ["values: { pairs: Record<string, string> }", "options?: unknown"],
		returns: "unknown",
	},
];

export class TypeGenerator {
	private static readonly KNOWN_CONSTRUCTORS = new Map<new (...args: any[]) => any, string>([
		[Date, "Date"],
		[RegExp, "RegExp"],
		[Error, "Error"],
		[ArrayBuffer, "ArrayBuffer"],
		[Uint8Array, "Uint8Array"],
		[Int32Array, "Int32Array"],
		...(typeof HTMLElement !== "undefined" ? [[HTMLElement, "HTMLElement"] as const] : []),
		...(typeof Element !== "undefined" ? [[Element, "Element"] as const] : []),
	] as [new (...args: any[]) => any, string][]);

	private store = new Map<string, StoreNode>();
	private visited = new Map<any, { kind: "reference"; id: string }>();
	private namingMap = new Map<string, string>();
	private structuralNodes = new Map<string, string>();

	private idCounter = 0;
	private invocationCount = 0;
	private awaitCount = 0;
	private nodeLimitHit = false;
	private invocationLimitHit = false;
	private awaitLimitHit = false;
	private nodeLimitWarned = false;
	private invokedReturns = new WeakMap<(...args: any[]) => any, WeakMap<any, InvocationResult>>();
	private awaitCandidates: { value: any; node: FunctionNode; returnName: string }[] = [];

	private readonly username: string | null;

	private rootObject: any;
	private rootName: string;
	private readonly methodTypes: readonly MethodType[];

	constructor(rootObject: any, rootName: string, methodTypes: readonly MethodType[] = []) {
		this.rootObject = rootObject;
		this.rootName = rootName;
		this.methodTypes = methodTypes;
		try {
			this.username = rootObject?.username ? String(rootObject.username) : null;
		} catch {
			this.username = null;
		}
	}

	public async generate(): Promise<string> {
		this.extract(this.rootObject, this.rootName);
		await this.resolveAwaitedReturns();
		this.assignNames();
		return this.emitTypeScript();
	}

	public get stats(): {
		types: number;
		invocations: number;
		awaits: number;
		limits: { nodes: boolean; invocations: boolean; awaits: boolean };
	} {
		return {
			types: this.store.size,
			invocations: this.invocationCount,
			awaits: this.awaitCount,
			limits: {
				nodes: this.nodeLimitHit,
				invocations: this.invocationLimitHit,
				awaits: this.awaitLimitHit,
			},
		};
	}

	private sanitizeString(str: string): string {
		if (this.username && str.includes(this.username)) {
			return str.split(this.username).join("USERNAME");
		}
		return str;
	}

	private addHint(node: { nameHints: string[] }, hint: string): void {
		if (!node.nameHints.includes(hint)) node.nameHints.push(hint);
	}

	private isPromiseLike(val: any): boolean {
		return !!val && (typeof val === "object" || typeof val === "function") && typeof val.then === "function";
	}

	private webApiName(value: any): string | null {
		for (const [globalValue, typeName] of WEB_GLOBAL_IDENTITIES) {
			if (value === globalValue) return typeName;
		}
		try {
			const name = value.constructor?.name;
			return name && WEB_API_CONSTRUCTOR_NAMES.has(name) ? name : null;
		} catch {
			return null;
		}
	}

	private isMergeableObject(val: any): boolean {
		if (!val || typeof val !== "object") return false;
		if (Array.isArray(val) || val instanceof Map || val instanceof Set) return false;
		if (this.isPromiseLike(val)) return false;
		if (this.webApiName(val)) return false;
		for (const [ctor] of TypeGenerator.KNOWN_CONSTRUCTORS) {
			if (val instanceof ctor) return false;
		}
		return true;
	}

	private getStructuralKey(obj: any): string {
		let ctorName = "Object";
		try {
			ctorName = obj.constructor?.name || "Object";
		} catch {}

		const keys: string[] = [];
		let current: any = obj;
		const seen = new Set<any>();
		while (current && current !== Object.prototype && current !== Function.prototype) {
			if (seen.has(current)) break;
			seen.add(current);
			try {
				for (const key of Object.getOwnPropertyNames(current)) {
					if (!IGNORED_PROPERTIES.has(key) && !keys.includes(key)) keys.push(key);
				}
			} catch {}
			try {
				current = Object.getPrototypeOf(current);
			} catch {
				break;
			}
		}

		return `${ctorName}|${keys.sort().join(",")}`;
	}

	private functionSignature(func: (...args: any[]) => any): string {
		const props: string[] = [];
		try {
			for (const key of Object.getOwnPropertyNames(func)) {
				if (!IGNORED_PROPERTIES.has(key)) props.push(key);
			}
		} catch {}
		return `fn:${func.length}:${this.isAsyncFunc(func) ? "async" : "sync"}:${props.sort().join(",")}`;
	}

	private mergeIntoNode(
		node: { props: Map<string, PropertyDef>; indexType?: TypeNode },
		obj: any,
		path: string,
	): void {
		let currentProto = obj;
		const indexValues: any[] = [];

		while (currentProto && currentProto !== Object.prototype && currentProto !== Function.prototype) {
			let descriptors: PropertyDescriptorMap = {};
			try {
				descriptors = Object.getOwnPropertyDescriptors(currentProto);
			} catch {}

			for (const [key, desc] of Object.entries(descriptors)) {
				if (typeof key === "symbol" || IGNORED_PROPERTIES.has(key)) continue;

				let propVal: any;
				if (desc.get) {
					try {
						propVal = obj[key];
					} catch {
						propVal = undefined;
					}
				} else {
					propVal = desc.value;
				}

				const cleanKey = this.sanitizeString(key);
				if (!IDENTIFIER_KEY.test(cleanKey)) {
					if (propVal !== undefined) indexValues.push(propVal);
					continue;
				}

				const existing = node.props.get(cleanKey);
				if (existing) {
					const newType = this.extractMergeValue(
						propVal,
						`${path}.${cleanKey}`,
						{ owner: obj, key },
						existing.type,
					);
					if (propVal === undefined) existing.isOptional = true;
					existing.type = this.collapseUnion([existing.type, newType]);
					if (!desc.writable && !desc.set) existing.isReadonly = true;
				} else {
					let pType = this.extract(propVal, `${path}.${cleanKey}`, {
						owner: obj,
						key,
					});
					if (pType.kind === "primitive" && pType.type === "undefined") {
						pType = { kind: "primitive", type: "unknown" };
					}
					node.props.set(cleanKey, {
						type: pType,
						isOptional: propVal === undefined,
						isReadonly: !desc.writable && !desc.set,
					});
				}
			}

			try {
				currentProto = Object.getPrototypeOf(currentProto);
			} catch {
				break;
			}
		}

		if (indexValues.length > 0) {
			node.indexType = this.collapseUnion([
				node.indexType,
				this.processCollectionElements(indexValues, `${path}.Item`),
			]);
		}
	}

	private propagateHints(value: any, path: string, seen: Set<string>, chain: Set<string>): void {
		const valueRef = this.visited.get(value);
		if (valueRef) {
			if (chain.has(valueRef.id)) return;
			chain.add(valueRef.id);
		}

		let currentProto = value;
		while (currentProto && currentProto !== Object.prototype && currentProto !== Function.prototype) {
			let descriptors: PropertyDescriptorMap = {};
			try {
				descriptors = Object.getOwnPropertyDescriptors(currentProto);
			} catch {}

			for (const [key, desc] of Object.entries(descriptors)) {
				if (typeof key === "symbol" || IGNORED_PROPERTIES.has(key)) continue;

				let child: any;
				if (desc.get) {
					try {
						child = value[key];
					} catch {
						continue;
					}
				} else {
					child = desc.value;
				}
				if (child === null || child === undefined) continue;
				const childType = typeof child;
				if (childType !== "object" && childType !== "function") continue;
				if (this.isPromiseLike(child) || this.webApiName(child)) continue;

				const ref = this.visited.get(child);
				if (!ref) continue;
				const node = this.store.get(ref.id);
				if (!node) continue;

				const keySegment =
					Array.isArray(value) || !IDENTIFIER_KEY.test(key) ? "Item" : this.sanitizeString(key);
				const childPath = `${path}.${keySegment}`;
				this.addHint(node, childPath);

				if (childType === "function" && node.kind === "function") {
					this.propagateFunctionReturn(child, value, node, childPath, seen, chain);
				}

				if (seen.has(ref.id)) continue;
				seen.add(ref.id);
				this.propagateHints(child, childPath, seen, chain);
			}

			try {
				currentProto = Object.getPrototypeOf(currentProto);
			} catch {
				break;
			}
		}

		if (valueRef) chain.delete(valueRef.id);
	}

	private propagateFunctionReturn(
		func: any,
		owner: any,
		funcNode: FunctionNode,
		path: string,
		seen: Set<string>,
		chain: Set<string>,
	): void {
		const retType = funcNode.returnType?.kind === "promise" ? funcNode.returnType.of : funcNode.returnType;
		if (!retType || retType.kind !== "reference") return;

		const retNode = this.store.get(retType.id);
		if (!retNode) return;
		const retPath = `${path}.Return`;
		this.addHint(retNode, retPath);

		const cached = this.invokedReturns.get(func)?.get(owner);
		if (cached?.ok && !this.isPromiseLike(cached.value)) {
			this.propagateHints(cached.value, retPath, seen, chain);
		}
	}

	private extract(value: any, path: string, context: ExtractContext | null = null): TypeNode {
		if (value === null) return { kind: "primitive", type: "null" };
		const basicType = typeof value;
		if (basicType !== "object" && basicType !== "function") {
			return { kind: "primitive", type: basicType };
		}

		if (this.isPromiseLike(value)) {
			return { kind: "promise", of: { kind: "primitive", type: "unknown" } };
		}

		for (const [ctor, typeName] of TypeGenerator.KNOWN_CONSTRUCTORS.entries()) {
			try {
				if (value instanceof ctor) return { kind: "class", name: typeName };
			} catch {}
		}

		const webName = this.webApiName(value);
		if (webName) return { kind: "class", name: webName };

		if (this.visited.has(value)) {
			const ref = this.visited.get(value);
			if (!ref) {
				return { kind: "primitive", type: "unknown" };
			}
			const safePath = this.sanitizeString(path);
			const node = this.store.get(ref.id);
			if (node) {
				this.addHint(node, safePath);
				this.propagateHints(value, safePath, new Set([ref.id]), new Set());
			}
			return ref;
		}

		const structuralKey =
			typeof value === "object" && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set)
				? this.getStructuralKey(value)
				: null;
		if (structuralKey) {
			const existingId = this.structuralNodes.get(structuralKey);
			if (existingId) {
				this.visited.set(value, { kind: "reference", id: existingId });
				const node = this.store.get(existingId);
				if (node && node.kind === "object") {
					this.addHint(node, this.sanitizeString(path));
					this.mergeIntoNode(node, value, this.sanitizeString(path));
				}
				return { kind: "reference", id: existingId };
			}
		}

		if (this.store.size >= MAX_NODES) {
			this.nodeLimitHit = true;
			if (!this.nodeLimitWarned) {
				this.nodeLimitWarned = true;
				console.warn(`[typegen] node limit (${MAX_NODES}) reached - remaining types degrade to unknown`);
			}
			return { kind: "primitive", type: "unknown" };
		}

		const id = `__Node_${++this.idCounter}`;
		const ref: { kind: "reference"; id: string } = { kind: "reference", id };
		this.visited.set(value, ref);
		if (structuralKey) this.structuralNodes.set(structuralKey, id);

		const safePath = this.sanitizeString(path);

		if (Array.isArray(value)) {
			const nodeDef: StoreNode = { kind: "array", id, nameHints: [safePath] };
			this.store.set(id, nodeDef);
			nodeDef.elementType = this.processCollectionElements(value, `${safePath}.Item`);
			return ref;
		}

		if (value instanceof Map) {
			const nodeDef: StoreNode = { kind: "map", id, nameHints: [safePath] };
			this.store.set(id, nodeDef);
			nodeDef.keyType = this.processCollectionElements(Array.from(value.keys()), `${safePath}.Key`);
			nodeDef.valueType = this.processCollectionElements(Array.from(value.values()), `${safePath}.Value`);
			return ref;
		}

		if (value instanceof Set) {
			const nodeDef: StoreNode = { kind: "set", id, nameHints: [safePath] };
			this.store.set(id, nodeDef);
			nodeDef.valueType = this.processCollectionElements(Array.from(value.values()), `${safePath}.Item`);
			return ref;
		}

		if (typeof value === "function") {
			const funcNodeDef: FunctionNode = {
				kind: "function",
				id,
				nameHints: [safePath],
				props: new Map<string, PropertyDef>(),
				arity: value.length,
				isAsync: this.isAsyncFunc(value),
				returnType: null,
			};
			funcNodeDef.returnType = this.inferFunctionReturn(value, context, safePath, funcNodeDef);
			this.store.set(id, funcNodeDef);
			this.extractProperties(value, funcNodeDef, safePath);
			return ref;
		}

		const objNodeDef = {
			kind: "object" as const,
			id,
			nameHints: [safePath],
			props: new Map<string, PropertyDef>(),
		};
		this.store.set(id, objNodeDef);
		this.extractProperties(value, objNodeDef, safePath);
		return ref;
	}

	private extractProperties(
		target: any,
		nodeDef: { props: Map<string, PropertyDef>; indexType?: TypeNode },
		path: string,
	): void {
		let currentProto = target;
		const indexValues: any[] = [];

		while (currentProto && currentProto !== Object.prototype && currentProto !== Function.prototype) {
			let descriptors: PropertyDescriptorMap = {};
			try {
				descriptors = Object.getOwnPropertyDescriptors(currentProto);
			} catch {}

			for (const [key, desc] of Object.entries(descriptors)) {
				if (typeof key === "symbol" || IGNORED_PROPERTIES.has(key)) continue;
				if (target === this.rootObject && IGNORED_ROOT_KEYS.has(key)) continue;

				const cleanKey = this.sanitizeString(key);

				let propVal: any;
				const isGetter = !!desc.get;
				if (isGetter) {
					try {
						propVal = target[key];
					} catch {
						propVal = undefined;
					}
				} else {
					propVal = desc.value;
				}

				if (!IDENTIFIER_KEY.test(cleanKey)) {
					if (propVal !== undefined) indexValues.push(propVal);
					continue;
				}

				if (!nodeDef.props.has(cleanKey)) {
					let pType = this.extract(propVal, `${path}.${cleanKey}`, {
						owner: target,
						key,
					});
					const isOpt = propVal === undefined;

					if (pType.kind === "primitive" && pType.type === "undefined") {
						pType = { kind: "primitive", type: "unknown" };
					}

					nodeDef.props.set(cleanKey, {
						type: pType,
						isOptional: isOpt,
						isReadonly: !desc.writable && !desc.set,
					});
				}
			}

			try {
				currentProto = Object.getPrototypeOf(currentProto);
			} catch {
				break;
			}
		}

		if (indexValues.length > 0) {
			nodeDef.indexType = this.collapseUnion([
				nodeDef.indexType,
				this.processCollectionElements(indexValues, `${path}.Item`),
			]);
		}
	}

	private getObjectSignature(obj: any): string {
		try {
			return Object.keys(obj).sort().join(",");
		} catch {
			return "unknown";
		}
	}

	private processCollectionElements(items: any[], subPath: string): TypeNode {
		if (items.length === 0) return { kind: "primitive", type: "unknown" };

		if (items.every((i) => Array.isArray(i))) {
			return this.extract(items.flat(), subPath);
		}
		if (items.every((i) => i instanceof Map)) {
			return this.extract(new Map(items.flatMap((m) => [...m.entries()])), subPath);
		}
		if (items.every((i) => i instanceof Set)) {
			return this.extract(new Set(items.flatMap((s) => [...s.values()])), subPath);
		}

		const types: TypeNode[] = [];
		const mergeableGroups = new Map<string, any[]>();
		const functionGroups = new Map<string, any[]>();

		for (const item of items) {
			if (item === undefined || item === null) {
				types.push({
					kind: "primitive",
					type: item === null ? "null" : "undefined",
				});
			} else if (typeof item === "string") {
				types.push({ kind: "primitive", type: "string" });
			} else if (typeof item === "number" || typeof item === "boolean") {
				types.push({ kind: "primitive", type: typeof item });
			} else if (this.visited.has(item)) {
				const ref = this.visited.get(item);
				if (ref) {
					types.push(ref);
				}
			} else if (this.isMergeableObject(item)) {
				const sig = this.getObjectSignature(item);
				const group = mergeableGroups.get(sig) ?? [];
				group.push(item);
				mergeableGroups.set(sig, group);
			} else if (typeof item === "function") {
				const sig = this.functionSignature(item);
				const group = functionGroups.get(sig) ?? [];
				group.push(item);
				functionGroups.set(sig, group);
			} else {
				types.push(this.extract(item, subPath));
			}
		}

		for (const functions of functionGroups.values()) {
			if (functions.length === 1) {
				types.push(this.extract(functions[0], subPath));
			} else {
				types.push(this.mergeFunctions(functions, subPath));
			}
		}

		for (const objects of mergeableGroups.values()) {
			if (objects.length === 1) {
				types.push(this.extract(objects[0], subPath));
			} else {
				types.push(this.mergeObjects(objects, subPath));
			}
		}

		return this.collapseUnion(types);
	}

	private mergeFunctions(functions: any[], path: string): TypeNode {
		const newId = `__Node_${++this.idCounter}`;
		const first = functions[0] ?? (() => {});
		const nodeDef: FunctionNode = {
			kind: "function",
			id: newId,
			nameHints: [path],
			props: new Map<string, PropertyDef>(),
			arity: first.length,
			isAsync: this.isAsyncFunc(first),
			returnType: null,
		};
		this.store.set(newId, nodeDef);

		for (const fn of functions) {
			this.visited.set(fn, { kind: "reference", id: newId });
			this.extractProperties(fn, nodeDef, path);
		}

		return { kind: "reference", id: newId };
	}

	private mergeObjects(objects: any[], path: string): TypeNode {
		const structuralKey = this.getStructuralKey(objects[0] ?? {});
		const existingId = this.structuralNodes.get(structuralKey);
		if (existingId) {
			for (const obj of objects) {
				this.visited.set(obj, { kind: "reference", id: existingId });
			}
			const node = this.store.get(existingId);
			if (node && node.kind === "object") {
				this.addHint(node, this.sanitizeString(path));
				for (const obj of objects) {
					this.mergeIntoNode(node, obj, path);
				}
			}
			return { kind: "reference", id: existingId };
		}

		const newId = `__Node_${++this.idCounter}`;
		const nodeDef: Extract<StoreNode, { kind: "object" }> = {
			kind: "object",
			id: newId,
			nameHints: [path],
			props: new Map<string, PropertyDef>(),
		};
		this.store.set(newId, nodeDef);
		this.structuralNodes.set(structuralKey, newId);

		for (const obj of objects) {
			this.visited.set(obj, { kind: "reference", id: newId });
		}

		const allKeys = new Set<string>();
		const objKeyMaps = new Map<any, Map<string, { value: any; isReadonly: boolean }>>();
		const indexValues: any[] = [];

		for (const obj of objects) {
			const keyMap = new Map<string, { value: any; isReadonly: boolean }>();
			objKeyMaps.set(obj, keyMap);

			let currentProto = obj;
			while (currentProto && currentProto !== Object.prototype && currentProto !== Function.prototype) {
				let descriptors: PropertyDescriptorMap = {};
				try {
					descriptors = Object.getOwnPropertyDescriptors(currentProto);
				} catch {}

				for (const [key, desc] of Object.entries(descriptors)) {
					if (typeof key === "symbol" || IGNORED_PROPERTIES.has(key)) continue;

					let propVal: any;
					if (desc.get) {
						try {
							propVal = obj[key];
						} catch {
							propVal = undefined;
						}
					} else {
						propVal = desc.value;
					}

					const cleanKey = this.sanitizeString(key);
					if (!IDENTIFIER_KEY.test(cleanKey)) {
						if (propVal !== undefined) indexValues.push(propVal);
						continue;
					}
					allKeys.add(cleanKey);

					if (!keyMap.has(cleanKey)) {
						let propVal: any;
						if (desc.get) {
							try {
								propVal = obj[key];
							} catch {
								propVal = undefined;
							}
						} else {
							propVal = desc.value;
						}
						keyMap.set(cleanKey, {
							value: propVal,
							isReadonly: !desc.writable && !desc.set,
						});
					}
				}

				try {
					currentProto = Object.getPrototypeOf(currentProto);
				} catch {
					break;
				}
			}
		}

		for (const key of allKeys) {
			let missingCount = 0;
			const valuesForKey: any[] = [];
			let isReadonly = true;

			for (const obj of objects) {
				const keyMap = objKeyMaps.get(obj);
				if (!keyMap) continue;
				if (keyMap.has(key)) {
					const data = keyMap.get(key);
					if (!data) continue;
					valuesForKey.push(data.value);
					if (!data.isReadonly) isReadonly = false;
				} else {
					missingCount++;
				}
			}

			const isOptional = missingCount > 0 || valuesForKey.some((v) => v === undefined);
			const definedValues = valuesForKey.filter((v) => v !== undefined);

			let mergedNestedType: TypeNode;
			if (definedValues.length === 0) {
				mergedNestedType = { kind: "primitive", type: "unknown" };
			} else {
				mergedNestedType = this.processCollectionElements(definedValues, `${path}.${key}`);
			}

			nodeDef.props.set(key, {
				type: mergedNestedType,
				isOptional,
				isReadonly,
			});
		}

		if (indexValues.length > 0) {
			nodeDef.indexType = this.collapseUnion([
				nodeDef.indexType,
				this.processCollectionElements(indexValues, `${path}.Item`),
			]);
		}

		return { kind: "reference", id: newId };
	}

	private extractMergeValue(value: any, path: string, context: ExtractContext, existingType: TypeNode): TypeNode {
		if (existingType.kind !== "reference") return this.extract(value, path, context);
		const node = this.store.get(existingType.id);
		if (!node) return this.extract(value, path, context);

		if (Array.isArray(value) && node.kind === "array") {
			node.elementType = this.collapseUnion([
				node.elementType,
				this.processCollectionElements(value, `${path}.Item`),
			]);
			return existingType;
		}
		if (value instanceof Map && node.kind === "map") {
			node.keyType = this.collapseUnion([
				node.keyType,
				this.processCollectionElements(Array.from(value.keys()), `${path}.Key`),
			]);
			node.valueType = this.collapseUnion([
				node.valueType,
				this.processCollectionElements(Array.from(value.values()), `${path}.Value`),
			]);
			return existingType;
		}
		if (value instanceof Set && node.kind === "set") {
			node.valueType = this.collapseUnion([
				node.valueType,
				this.processCollectionElements(Array.from(value.values()), `${path}.Item`),
			]);
			return existingType;
		}

		return this.extract(value, path, context);
	}

	private collapseUnion(types: (TypeNode | undefined)[]): TypeNode {
		const flat = new Map<string, TypeNode>();

		const addType = (t: TypeNode | undefined) => {
			if (!t) return;
			if (t.kind === "union") t.types.forEach(addType);
			else {
				const key =
					t.kind === "primitive"
						? `prim:${t.type}`
						: t.kind === "class"
							? `cls:${t.name}`
							: t.kind === "reference"
								? `ref:${t.id}`
								: JSON.stringify(t);
				flat.set(key, t);
			}
		};

		types.forEach(addType);
		let unique = Array.from(flat.values());

		if (unique.length > 1) {
			unique = unique.filter((t) => !(t.kind === "primitive" && (t.type === "unknown" || t.type === "any")));
		}

		if (unique.length === 0) return { kind: "primitive", type: "unknown" };
		if (unique.length === 1) {
			const single = unique[0];
			if (single) return single;
		}

		unique.sort((a, b) => {
			const getCmpName = (node: TypeNode): string => {
				switch (node.kind) {
					case "primitive":
						return node.type;
					case "class":
						return node.name;
					case "reference":
						return node.id;
					default:
						return "";
				}
			};
			return getCmpName(a).localeCompare(getCmpName(b));
		});

		return { kind: "union", types: unique };
	}

	private isAsyncFunc(func: (...args: any[]) => any): boolean {
		try {
			const str = func.toString();
			return (
				func.constructor.name === "AsyncFunction" ||
				str.startsWith("async") ||
				str.includes("__awaiter") ||
				str.includes("return new Promise")
			);
		} catch {
			return false;
		}
	}

	private inferFunctionReturn(
		func: (...args: any[]) => any,
		context: ExtractContext | null,
		path: string,
		node: FunctionNode,
	): TypeNode | null {
		if (!context) return null;

		const isRead = READ_PATTERN.test(context.key);
		const isListener = LISTENER_PATTERN.test(context.key);
		if (!isRead && !isListener) return null;

		if (this.overrideFor(node)) return null;

		if (isListener && func.length > 1) return null;

		const synthesizedArgs = isListener && func.length === 1 ? [NOOP_CALLBACK] : [];

		const ownerCache = this.invokedReturns.get(func);
		const cached = ownerCache?.get(context.owner);

		let ret: any;
		if (cached) {
			if (!cached.ok) return null;
			ret = cached.value;
		} else {
			if (this.invocationCount >= MAX_INVOCATIONS) {
				this.invocationLimitHit = true;
				return null;
			}
			this.invocationCount++;

			const cache = ownerCache ?? new WeakMap<any, InvocationResult>();
			if (!ownerCache) this.invokedReturns.set(func, cache);
			try {
				ret = func.apply(context.owner, synthesizedArgs);
				cache.set(context.owner, { ok: true, value: ret });
			} catch {
				cache.set(context.owner, { ok: false });
				return null;
			}
		}

		if (ret === undefined) return null;
		if (ret === null && synthesizedArgs.length > 0) return null;

		const returnName = `${path}.Return`;

		if (this.isPromiseLike(ret)) {
			if (this.awaitCount >= MAX_AWAITS) {
				this.awaitLimitHit = true;
				return { kind: "promise", of: { kind: "primitive", type: "unknown" } };
			}
			this.awaitCount++;
			this.awaitCandidates.push({ value: ret, node, returnName });
			return { kind: "promise", of: { kind: "primitive", type: "unknown" } };
		}

		return this.extract(ret, returnName);
	}

	private async resolveAwaitedReturns(): Promise<void> {
		if (this.awaitCandidates.length === 0) return;

		const timeout = new Promise<void>((resolve) => {
			setTimeout(() => resolve(), AWAIT_TIMEOUT_MS);
		});

		const candidates = this.awaitCandidates.splice(0);
		await Promise.all(candidates.map((candidate) => this.resolveCandidate(candidate, timeout)));
	}

	private async resolveCandidate(
		candidate: { value: any; node: FunctionNode; returnName: string },
		timeout: Promise<void>,
	): Promise<void> {
		let resolved: any;
		try {
			resolved = await Promise.race([candidate.value, timeout]);
		} catch {
			return;
		}
		if (resolved === undefined) return;

		const ofType = this.extract(resolved, candidate.returnName);
		candidate.node.returnType = { kind: "promise", of: ofType };

		const bestHint = [...candidate.node.nameHints].sort((a, b) => this.scoreHint(a) - this.scoreHint(b))[0];
		const retRef = this.visited.get(resolved);
		if (bestHint && retRef) {
			const retNode = this.store.get(retRef.id);
			if (retNode) {
				const retPath = `${bestHint}.Return`;
				this.addHint(retNode, retPath);
				this.propagateHints(resolved, retPath, new Set([retRef.id]), new Set());
			}
		}
	}

	private assignNames(): void {
		const usedNames = new Set<string>();
		const rootEntry = Array.from(this.store.entries()).find(([_, node]) => node.nameHints.includes(this.rootName));

		for (const [id, node] of this.store.entries()) {
			if (id === rootEntry?.[0]) {
				this.namingMap.set(id, this.rootName);
				usedNames.add(this.rootName);
				continue;
			}

			const bestHint = [...node.nameHints].sort((a, b) => this.scoreHint(a) - this.scoreHint(b))[0] || id;

			const cleanHint = bestHint.startsWith(`${this.rootName}.`)
				? bestHint.slice(this.rootName.length + 1)
				: bestHint;

			let baseName = cleanHint
				.replace(/\[\d+\]/g, "")
				.split(/[._[\]]/)
				.filter(Boolean)
				.map((p) => p.replace(/[^a-zA-Z0-9_$]/g, ""))
				.map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ""))
				.join("");

			const hintSegments = cleanHint.split(".");
			const lastSeg = hintSegments[hintSegments.length - 1];
			const secondLast = hintSegments[hintSegments.length - 2];
			if (lastSeg === "Return" && secondLast && READ_PATTERN.test(secondLast)) {
				const target = secondLast.replace(/^get/i, "");
				const targetPascal = target ? target.charAt(0).toUpperCase() + target.slice(1) : "";
				if (hintSegments.length === 2) {
					baseName = targetPascal;
				} else {
					const tail = `Get${targetPascal}Return`;
					if (targetPascal && baseName.endsWith(tail)) {
						baseName = `${baseName.slice(0, -tail.length)}${targetPascal}`;
					}
				}
			}

			if (!baseName) {
				baseName = `Unknown${node.kind.charAt(0).toUpperCase() + node.kind.slice(1)}`;
			}

			const finalName = usedNames.has(baseName)
				? (this.nameWithSuffix(baseName, node.nameHints, usedNames) ?? this.numericName(baseName, usedNames, 2))
				: baseName;

			usedNames.add(finalName);
			this.namingMap.set(id, finalName);
		}
	}

	private scoreHint(hint: string): number {
		const segments = hint.split(".");
		let score = segments.length * 10;
		if (segments.some((s) => s.startsWith("_"))) score += 100;
		if (
			segments.some((s) => {
				const lower = s.toLowerCase();
				return lower === "registry" || lower === "getregistry";
			})
		) {
			score += 1000;
		}
		if (segments[segments.length - 1] === "Return") score -= 3;
		return score;
	}

	private nameWithSuffix(baseName: string, hints: string[], usedNames: Set<string>): string | null {
		const rootPrefix = `${this.rootName}.`;
		for (const hint of hints) {
			if (hint === baseName) continue;

			const clean = hint.startsWith(rootPrefix) ? hint.slice(rootPrefix.length) : hint;
			const parts = clean
				.split(/[._[\]]/)
				.map((p) => p.replace(/[^a-zA-Z0-9_$]/g, ""))
				.filter(
					(p) =>
						p && !NOISE_SEGMENTS.has(p.toLowerCase()) && !baseName.toLowerCase().includes(p.toLowerCase()),
				);
			if (parts.length === 0) continue;

			const candidate = parts
				.join("")
				.replace(/^Get/i, "")
				.replace(/(Get|Fetch|Load|Query)\w*$/i, "");

			if (!candidate || candidate === baseName) continue;

			const full = `${baseName}_${candidate}`;
			if (usedNames.has(full)) continue;
			return full;
		}
		return null;
	}

	private numericName(baseName: string, usedNames: Set<string>, start: number): string {
		let counter = start;
		let name = `${baseName}${counter}`;
		while (usedNames.has(name)) name = `${baseName}${++counter}`;
		return name;
	}

	private resolveTypeString(typeNode: TypeNode | undefined): string {
		if (!typeNode) return "unknown";
		switch (typeNode.kind) {
			case "primitive":
				return typeNode.type;
			case "class":
				return typeNode.name;
			case "reference":
				return this.namingMap.get(typeNode.id) || "unknown";
			case "promise":
				return `Promise<${this.resolveTypeString(typeNode.of)}>`;
			case "union": {
				const resolved = typeNode.types.map((t) => this.resolveTypeString(t));
				return Array.from(new Set(resolved)).join(" | ");
			}
			default:
				return "unknown";
		}
	}

	private overrideFor(node: FunctionNode): MethodType | null {
		const rootPrefix = `${this.rootName}.`;
		for (const hint of node.nameHints) {
			const clean = hint.startsWith(rootPrefix) ? hint.slice(rootPrefix.length) : hint;
			const segments = clean.split(".");
			for (const methodType of this.methodTypes) {
				if (this.isSubsequence(this.parseCallExpression(methodType.on), segments)) {
					return methodType;
				}
			}
		}
		return null;
	}

	private parseCallExpression(expression: string): string[] {
		return expression
			.replace(/^Platform\./, "")
			.split(/\.|\(\)/)
			.filter(Boolean);
	}

	private isSubsequence(needle: readonly string[], haystack: string[]): boolean {
		let i = 0;
		for (const segment of haystack) {
			if (i < needle.length && segment === needle[i]) i++;
		}
		return i === needle.length;
	}

	private defaultArgs(node: FunctionNode): string {
		return Array.from({ length: node.arity }, (_, i) => `arg${i}: any`).join(", ");
	}

	private defaultReturn(node: FunctionNode): string {
		return node.returnType
			? this.resolveTypeString(node.returnType)
			: node.isAsync
				? "Promise<unknown>"
				: "unknown";
	}

	private renderSignature(node: FunctionNode): string {
		return this.renderCallable(node, " => ");
	}

	private renderCallSignature(node: FunctionNode): string {
		return this.renderCallable(node, ": ");
	}

	private renderCallable(node: FunctionNode, separator: string): string {
		const override = this.overrideFor(node);
		if (override) {
			return `(${override.args.join(", ")})${separator}${override.returns ?? this.defaultReturn(node)}`;
		}
		return `(${this.defaultArgs(node)})${separator}${this.defaultReturn(node)}`;
	}

	private emitTypeScript(): string {
		const definitions: { name: string; declaration: string }[] = [];

		for (const [id, node] of this.store.entries()) {
			const name = this.namingMap.get(id) || id;
			let declaration = "";

			const isRoot = name === this.rootName;
			const exportStr = isRoot ? "export " : "";

			if (node.kind === "array") {
				declaration = `${exportStr}type ${name} = Array<${this.resolveTypeString(node.elementType)}>;`;
			} else if (node.kind === "map") {
				declaration = `${exportStr}type ${name} = Map<${this.resolveTypeString(
					node.keyType,
				)}, ${this.resolveTypeString(node.valueType)}>;`;
			} else if (node.kind === "set") {
				declaration = `${exportStr}type ${name} = Set<${this.resolveTypeString(node.valueType)}>;`;
			} else if (node.kind === "object" || node.kind === "function") {
				if (node.kind === "function" && node.props.size === 0) {
					declaration = `${exportStr}type ${name} = ${this.renderSignature(node)};`;
				} else if (node.kind === "object" && node.indexType && node.props.size === 0) {
					declaration = `${exportStr}type ${name} = Record<string, ${this.resolveTypeString(
						node.indexType,
					)}>;`;
				} else {
					const propsOutput: string[] = [];

					if (node.kind === "function") {
						propsOutput.push(`  ${this.renderCallSignature(node)};`);
					}

					const sortedKeys = Array.from(node.props.keys()).sort();
					for (const key of sortedKeys) {
						const prop = node.props.get(key);
						if (!prop) continue;
						const safeKey = IDENTIFIER_KEY.test(key) ? key : `"${key}"`;
						const opt = prop.isOptional ? "?" : "";
						const ro = prop.isReadonly ? "readonly " : "";
						propsOutput.push(`  ${ro}${safeKey}${opt}: ${this.resolveTypeString(prop.type)};`);
					}

					if (propsOutput.length === 0) {
						declaration = `${exportStr}type ${name} = Record<string, unknown>;`;
					} else if (node.kind === "object" && node.indexType) {
						const record = `Record<string, ${this.resolveTypeString(node.indexType)}>`;
						declaration = `${exportStr}type ${name} = ${record} & {\n${propsOutput.join("\n")}\n};`;
					} else {
						declaration = `${exportStr}interface ${name} {\n${propsOutput.join("\n")}\n}`;
					}
				}
			}

			definitions.push({ name, declaration });
		}

		definitions.sort((a, b) =>
			a.name === this.rootName ? -1 : b.name === this.rootName ? 1 : a.name.localeCompare(b.name),
		);

		const warnings: string[] = [];
		if (this.nodeLimitHit) warnings.push("node limit");
		if (this.invocationLimitHit) warnings.push("invocation limit");
		if (this.awaitLimitHit) warnings.push("await limit");
		const warningSuffix =
			warnings.length > 0 ? ` [WARN: ${warnings.join(", ")} hit - output degraded to unknown]` : "";

		const header = `// Auto-generated at ${new Date().toISOString()} on Spotify Version: ${String(
			this.rootObject?.version ?? "Unknown",
		)}${warningSuffix}`;
		return [header, ...definitions.map((d) => d.declaration)].join("\n\n");
	}
}
